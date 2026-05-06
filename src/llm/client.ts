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

type RequestOptions = { timeout?: number };

// Minimal structural interface — the real Anthropic client satisfies this.
export type SDKLike = {
  messages: {
    create: (params: CreateParams, options?: RequestOptions) => Promise<SDKResponse>;
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
  timeoutMs?: number;
};

const MAX_429_RETRIES = 3;

const CORRECTIVE_MESSAGE =
  "Your previous response was not valid JSON. Respond only with a valid JSON object matching the required schema. Do not include markdown, code fences, or any text outside the JSON object.";

function extractText(response: SDKResponse): string {
  const block = response.content.find(
    (b): b is { type: "text"; text: string } => b.type === "text"
  );
  if (!block) {
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

function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as Record<string, unknown>)["name"] === "APIConnectionTimeoutError"
  );
}

function isStatusError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as Record<string, unknown>)["status"] === "number"
  );
}

function isNetworkError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>)["code"] === "string"
  );
}

function statusErrorMessage(status: number, original: string): string {
  if (status === 401 || status === 403)
    return `Authentication failed. Check that ANTHROPIC_API_KEY in your .env is set correctly and the key is active. Original error: ${original}`;
  if (status === 404)
    return `Model not found. Check that CLAUDE_MODEL in your .env refers to a valid Anthropic model. Original error: ${original}`;
  return `LLM API error ${status}: ${original}`;
}

function networkErrorMessage(err: unknown): string {
  if (isNetworkError(err)) {
    const networkCodes = ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENETUNREACH"];
    if (networkCodes.includes(err.code))
      return `Network error: could not reach Anthropic API. Check your internet connection. (${err.code})`;
  }
  const e = err as Record<string, unknown>;
  const name = typeof e["name"] === "string" ? e["name"] : "";
  const msg = typeof e["message"] === "string" ? e["message"] : String(err);
  if (name === "AbortError" || msg.toLowerCase().includes("aborted"))
    return "Request timed out. The Anthropic API may be slow or unreachable. Check your internet connection and try again.";
  return `Unexpected error calling LLM: ${msg}`;
}

export function createLLMClient(
  sdk: SDKLike,
  config: LLMClientConfig,
  delay: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms))
) {
  const { model, maxTokens = 4096, timeoutMs = 60000 } = config;

  async function callSDK(systemPrompt: string, messages: Message[]): Promise<string> {
    const response = await sdk.messages.create(
      { model, max_tokens: maxTokens, system: systemPrompt, messages },
      { timeout: timeoutMs }
    );
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
        if (isTimeoutError(err)) {
          throw new LLMError(`LLM call timed out after ${timeoutMs / 1000}s`, false);
        }
        if (isStatusError(err)) {
          if (err.status === 429) {
            if (attempt < MAX_429_RETRIES) {
              await delay(1000 * 2 ** attempt);
              continue;
            }
            throw new LLMError(
              `Rate limit exceeded after ${MAX_429_RETRIES} retries. The API is currently throttling requests. Wait a moment and try again.`,
              false
            );
          }
          if (err.status >= 500) {
            await delay(2000);
            try {
              return await callSDK(systemPrompt, messages);
            } catch (retryErr) {
              const code = isStatusError(retryErr) ? retryErr.status : err.status;
              throw new LLMError(
                `Anthropic service is currently unavailable (status ${code}). Try again in a few moments. If the problem persists, check status.anthropic.com.`,
                false
              );
            }
          }
          throw new LLMError(statusErrorMessage(err.status, err.message), false);
        }
        if (err instanceof LLMError) throw err;
        throw new LLMError(networkErrorMessage(err), false);
      }
    }
    // Unreachable: loop always returns or throws before exhausting iterations.
    throw new LLMError(
      `Rate limit exceeded after ${MAX_429_RETRIES} retries. The API is currently throttling requests. Wait a moment and try again.`,
      false
    );
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
