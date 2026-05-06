import { describe, it, expect } from "vitest";
import { createLLMClient, LLMError } from "../../src/llm/client.js";
import type { SDKLike } from "../../src/llm/client.js";

const noDelay = () => Promise.resolve();

// ── Helpers ──────────────────────────────────────────────────────────────────

type SDKResponse = { content: Array<{ type: "text"; text: string } | { type: string }> };

function textResponse(value: unknown): SDKResponse {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function rawResponse(text: string): SDKResponse {
  return { content: [{ type: "text", text }] };
}

function emptyResponse(): SDKResponse {
  return { content: [] };
}

function statusError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function timeoutError(): Error {
  return Object.assign(new Error("Connection timed out"), {
    name: "APIConnectionTimeoutError",
  });
}

function mockSDK(responses: Array<SDKResponse | Error>): SDKLike {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const res = responses[i++];
        if (res === undefined) throw new Error("Unexpected extra SDK call");
        if (res instanceof Error) throw res;
        return res;
      },
    },
  };
}

const SYSTEM = "You are an agent.";
const MESSAGES = [{ role: "user" as const, content: "hello" }];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createLLMClient / call", () => {
  it("returns parsed JSON on a successful call", async () => {
    const payload = { type: "final_answer", answer: "42", sources: [] };
    const client = createLLMClient(mockSDK([textResponse(payload)]), { model: "m" }, noDelay);
    const result = await client.call(SYSTEM, MESSAGES);
    expect(result).toEqual(payload);
  });

  it("retries on 429 and succeeds", async () => {
    const payload = { type: "final_answer", answer: "ok", sources: [] };
    const sdk = mockSDK([statusError(429), statusError(429), textResponse(payload)]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    const result = await client.call(SYSTEM, MESSAGES);
    expect(result).toEqual(payload);
  });

  it("throws LLMError after exhausting 429 retries", async () => {
    const sdk = mockSDK([
      statusError(429),
      statusError(429),
      statusError(429),
      statusError(429),
    ]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(/Rate limit/);
  });

  it("retries once on 5xx and succeeds", async () => {
    const payload = { type: "final_answer", answer: "ok", sources: [] };
    const sdk = mockSDK([statusError(503), textResponse(payload)]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    const result = await client.call(SYSTEM, MESSAGES);
    expect(result).toEqual(payload);
  });

  it("throws LLMError when 5xx retry also fails", async () => {
    const sdk = mockSDK([statusError(500), statusError(500)]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(LLMError);
  });

  it("retries with corrective message on invalid JSON and succeeds", async () => {
    const payload = { type: "final_answer", answer: "recovered", sources: [] };
    const sdk = mockSDK([rawResponse("not json at all"), textResponse(payload)]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    const result = await client.call(SYSTEM, MESSAGES);
    expect(result).toEqual(payload);
  });

  it("throws LLMError when corrective retry also returns invalid JSON", async () => {
    const sdk = mockSDK([rawResponse("still not json"), rawResponse("also bad")]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(/invalid JSON/);
  });

  it("throws LLMError when response has no text block", async () => {
    const sdk = mockSDK([emptyResponse()]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(LLMError);
  });

  it("throws LLMError on unexpected non-HTTP errors", async () => {
    const sdk = mockSDK([new Error("network failure")]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(LLMError);
  });

  it("throws LLMError with clear message on timeout", async () => {
    const sdk = mockSDK([timeoutError()]);
    const client = createLLMClient(sdk, { model: "m", timeoutMs: 60000 }, noDelay);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(/timed out after 60s/);
    await expect(client.call(SYSTEM, MESSAGES)).rejects.toThrow(LLMError);
  });

  it("correctly parses JSON null without confusing it with parse failure", async () => {
    const sdk = mockSDK([rawResponse("null")]);
    const client = createLLMClient(sdk, { model: "m" }, noDelay);
    const result = await client.call(SYSTEM, MESSAGES);
    expect(result).toBeNull();
  });
});
