import { LLMResponse } from "./contract.js";
import type { AgentEvent } from "./events.js";
import { LLMError } from "../llm/client.js";
import type { LLMClient, Message } from "../llm/client.js";
import type { Registry } from "../tools/registry.js";

const TOOL_RESULT_MAX_CHARS = 8000;

const SCHEMA_CORRECTIVE_PREFIX =
  "Your previous response did not match the required schema. " +
  'Respond only with {"type":"tool_call",...} or {"type":"final_answer",...}. ' +
  "Validation error: ";

export async function* run(
  userMessage: string,
  history: Message[],
  registry: Registry,
  llmClient: LLMClient,
  systemPrompt: string,
  maxIterations = 20
): AsyncGenerator<AgentEvent> {
  history.push({ role: "user", content: userMessage });
  yield { type: "user_message", text: userMessage };

  let consecutiveValidationFailures = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ── LLM call ────────────────────────────────────────────────────────────
    let rawResponse: unknown;
    try {
      rawResponse = await llmClient.call(systemPrompt, history);
    } catch (err) {
      const message = err instanceof LLMError ? err.message : String(err);
      yield { type: "error", message, recoverable: false };
      return;
    }

    // ── Schema validation ────────────────────────────────────────────────────
    const parsed = LLMResponse.safeParse(rawResponse);
    if (!parsed.success) {
      consecutiveValidationFailures++;
      if (consecutiveValidationFailures >= 2) {
        yield {
          type: "error",
          message: `LLM returned an invalid response twice in a row: ${parsed.error.message}`,
          recoverable: false,
        };
        return;
      }
      history.push({
        role: "user",
        content: SCHEMA_CORRECTIVE_PREFIX + parsed.error.message,
      });
      continue;
    }

    consecutiveValidationFailures = 0;
    const response = parsed.data;
    history.push({ role: "assistant", content: JSON.stringify(rawResponse) });

    // ── Final answer ─────────────────────────────────────────────────────────
    if (response.type === "final_answer") {
      yield { type: "final_answer", text: response.answer, sources: response.sources };
      return;
    }

    // ── Tool call ────────────────────────────────────────────────────────────
    yield { type: "thinking", reasoning: response.reasoning };
    yield { type: "tool_call", toolName: response.tool_name, args: response.tool_args };

    const toolResult = await registry.dispatch(response.tool_name, response.tool_args);
    const truncated = toolResult.length > TOOL_RESULT_MAX_CHARS;
    const displayResult = truncated
      ? toolResult.slice(0, TOOL_RESULT_MAX_CHARS) + "\n[truncated]"
      : toolResult;

    yield {
      type: "tool_result",
      toolName: response.tool_name,
      result: displayResult,
      truncated,
    };

    history.push({
      role: "user",
      content: `Tool result for ${response.tool_name}:\n${toolResult}`,
    });
  }

  yield { type: "iteration_limit_reached", limit: maxIterations };
}
