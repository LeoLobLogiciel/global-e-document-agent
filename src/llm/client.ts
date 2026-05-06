export type Message = {
  role: "user" | "assistant";
  content: string;
};

type CreateParams = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Message[];
};

type ContentBlock = { type: "text"; text: string } | { type: string };

type SDKResponse = { content: ContentBlock[] };

// Minimal structural interface — the real Anthropic client satisfies this.
export type SDKLike = {
  messages: {
    create: (params: CreateParams) => Promise<SDKResponse>;
  };
};

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export type LLMClientConfig = {
  model: string;
  maxTokens?: number;
};

const MAX_429_RETRIES = 3;

const CORRECTIVE_MESSAGE =
  "Your previous response was not valid JSON. Respond only with a valid JSON object matching the required schema. Do not include markdown, code fences, or any text outside the JSON object.";

function extractText(response: SDKResponse): string {
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new LLMError("No text block in LLM response", false);
  }
  return block.text;
}

function tryParseJSON(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isStatusError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as Record<string, unknown>)["status"] === "number"
  );
}

export function createLLMClient(
  sdk: SDKLike,
  config: LLMClientConfig,
  delay: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms))
) {
  const { model, maxTokens = 4096 } = config;

  async function callSDK(systemPrompt: string, messages: Message[]): Promise<string> {
    const response = await sdk.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    return extractText(response);
  }

  async function callWithHttpRetry(
    systemPrompt: string,
    messages: Message[]
  ): Promise<string> {
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      try {
        return await callSDK(systemPrompt, messages);
      } catch (err) {
        if (isStatusError(err)) {
          if (err.status === 429) {
            if (attempt < MAX_429_RETRIES) {
              await delay(1000 * 2 ** attempt);
              continue;
            }
            throw new LLMError("Rate limit exceeded after retries", false);
          }
          if (err.status >= 500) {
            await delay(2000);
            try {
              return await callSDK(systemPrompt, messages);
            } catch (retryErr) {
              throw new LLMError(
                `LLM server error after retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                false
              );
            }
          }
          throw new LLMError(`LLM API error ${err.status}: ${err.message}`, false);
        }
        if (err instanceof LLMError) throw err;
        throw new LLMError(`Unexpected error calling LLM: ${String(err)}`, false);
      }
    }
    // Unreachable: loop always returns or throws before exhausting iterations.
    throw new LLMError("Rate limit exceeded after retries", false);
  }

  async function call(
    systemPrompt: string,
    messages: Message[]
  ): Promise<unknown> {
    const raw = await callWithHttpRetry(systemPrompt, messages);

    const parsed = tryParseJSON(raw);
    if (parsed.ok) return parsed.value;

    // One retry: append the bad response + a corrective user message.
    const correctedMessages: Message[] = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: CORRECTIVE_MESSAGE },
    ];
    const retryRaw = await callWithHttpRetry(systemPrompt, correctedMessages);
    const retryParsed = tryParseJSON(retryRaw);
    if (retryParsed.ok) return retryParsed.value;

    throw new LLMError(
      `LLM returned invalid JSON after corrective retry: ${retryRaw.slice(0, 200)}`,
      false
    );
  }

  return { call };
}

export type LLMClient = ReturnType<typeof createLLMClient>;
