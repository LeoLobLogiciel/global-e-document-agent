import { describe, it, expect } from "vitest";
import { run } from "../../src/agent/loop.js";
import { LLMError } from "../../src/llm/client.js";
import type { LLMClient, Message } from "../../src/llm/client.js";
import type { Registry } from "../../src/tools/registry.js";
import type { AgentEvent } from "../../src/agent/events.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolCall(toolName: string, args: Record<string, unknown> = {}): unknown {
  return { type: "tool_call", reasoning: "test reasoning", tool_name: toolName, tool_args: args };
}

function finalAnswer(answer: string, sources: string[] = ["doc.md"]): unknown {
  return { type: "final_answer", answer, sources };
}

function mockLLM(responses: Array<unknown | Error>): LLMClient {
  let i = 0;
  return {
    call: async () => {
      const res = responses[i++];
      if (res === undefined) throw new Error("Unexpected extra LLM call");
      if (res instanceof Error) throw res;
      return res;
    },
  };
}

function mockRegistry(result = "tool output"): Registry {
  return { tools: [], dispatch: async () => result };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function freshHistory(): Message[] {
  return [];
}

const SYSTEM = "system prompt";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("agent loop — final answer", () => {
  it("emits user_message then final_answer and stops", async () => {
    const llm = mockLLM([finalAnswer("The answer is 42")]);
    const events = await collect(run("what is 42?", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(events[0]).toEqual({ type: "user_message", text: "what is 42?" });
    expect(events.at(-1)).toMatchObject({ type: "final_answer", text: "The answer is 42" });
    expect(events).toHaveLength(2);
  });

  it("includes sources in the final_answer event", async () => {
    const llm = mockLLM([finalAnswer("answer", ["meetings.md", "sales-q1.csv"])]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    const fa = events.find((e) => e.type === "final_answer");
    expect(fa).toMatchObject({ sources: ["meetings.md", "sales-q1.csv"] });
  });
});

describe("agent loop — tool call", () => {
  it("emits thinking, tool_call, tool_result, then final_answer", async () => {
    const llm = mockLLM([toolCall("read_document", { filename: "notes.txt" }), finalAnswer("done")]);
    const events = await collect(run("q", freshHistory(), mockRegistry("file content"), llm, SYSTEM));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "user_message",
      "thinking",
      "tool_call",
      "tool_result",
      "final_answer",
    ]);
  });

  it("passes tool_name and args through to the tool_call event", async () => {
    const llm = mockLLM([toolCall("read_document", { filename: "notes.txt" }), finalAnswer("done")]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    const tc = events.find((e) => e.type === "tool_call");
    expect(tc).toMatchObject({ toolName: "read_document", args: { filename: "notes.txt" } });
  });

  it("feeds tool result back into the next LLM call via history", async () => {
    const capturedHistories: Message[][] = [];
    const llm: LLMClient = {
      call: async (_sys, history) => {
        capturedHistories.push([...history]);
        if (capturedHistories.length === 1) return toolCall("list_documents");
        return finalAnswer("done");
      },
    };

    await collect(run("q", freshHistory(), mockRegistry("doc list"), llm, SYSTEM));

    // Second LLM call history must include the tool result as a user message.
    const secondHistory = capturedHistories[1] ?? [];
    const toolResultMsg = secondHistory.find(
      (m) => m.role === "user" && m.content.includes("doc list")
    );
    expect(toolResultMsg).toBeDefined();
  });

  it("truncates long tool results in the event but sends full result to history", async () => {
    const longOutput = "x".repeat(9000);
    const capturedHistories: Message[][] = [];
    const llm: LLMClient = {
      call: async (_sys, history) => {
        capturedHistories.push([...history]);
        if (capturedHistories.length === 1) return toolCall("read_document", { filename: "f" });
        return finalAnswer("done");
      },
    };
    const registry: Registry = { tools: [], dispatch: async () => longOutput };

    const events = await collect(run("q", freshHistory(), registry, llm, SYSTEM));

    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toMatchObject({ truncated: true });
    if (tr?.type === "tool_result") expect(tr.result.length).toBeLessThan(9000);

    // Full result in history.
    const secondHistory = capturedHistories[1] ?? [];
    const histMsg = secondHistory.find((m) => m.role === "user" && m.content.includes("x".repeat(100)));
    expect(histMsg?.content.length).toBeGreaterThan(8000);
  });
});

describe("agent loop — error handling", () => {
  it("emits error event when LLM throws LLMError and stops", async () => {
    const llm = mockLLM([new LLMError("API down", false)]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(events.at(-1)).toMatchObject({ type: "error", message: "API down" });
  });

  it("retries once on schema validation failure and continues", async () => {
    // First response: wrong shape. Second: valid final answer.
    const llm = mockLLM([{ type: "unknown_garbage" }, finalAnswer("recovered")]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(events.at(-1)).toMatchObject({ type: "final_answer", text: "recovered" });
    expect(events.find((e) => e.type === "error")).toBeUndefined();
  });

  it("emits error after two consecutive schema validation failures", async () => {
    const llm = mockLLM([{ type: "bad" }, { type: "also_bad" }]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(events.at(-1)).toMatchObject({ type: "error" });
    if (events.at(-1)?.type === "error") {
      expect(events.at(-1)).toMatchObject({ recoverable: false });
    }
  });

  it("resets consecutive failure counter after a valid response", async () => {
    // fail, succeed (tool call), fail, succeed (final answer) — never two consecutive
    const llm = mockLLM([
      { type: "bad" },
      toolCall("list_documents"),
      { type: "bad" },
      finalAnswer("ok"),
    ]);
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(events.at(-1)).toMatchObject({ type: "final_answer" });
  });

  it("tool errors flow back as tool_result events, not exceptions", async () => {
    const registry: Registry = {
      tools: [],
      dispatch: async () => 'Error: file not found',
    };
    const llm = mockLLM([toolCall("read_document"), finalAnswer("done")]);
    const events = await collect(run("q", freshHistory(), registry, llm, SYSTEM));

    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toMatchObject({ result: "Error: file not found" });
    expect(events.find((e) => e.type === "error")).toBeUndefined();
  });
});

describe("agent loop — iteration limit", () => {
  it("emits iteration_limit_reached after maxIterations tool calls", async () => {
    // Always returns a tool call — never terminates on its own.
    const llm: LLMClient = { call: async () => toolCall("list_documents") };
    const events = await collect(run("q", freshHistory(), mockRegistry(), llm, SYSTEM, 3));

    expect(events.at(-1)).toMatchObject({ type: "iteration_limit_reached", limit: 3 });
  });
});

describe("agent loop — history accumulation", () => {
  it("appends user message to history before calling LLM", async () => {
    let capturedHistory: Message[] = [];
    const llm: LLMClient = {
      call: async (_sys, history) => {
        capturedHistory = [...history];
        return finalAnswer("done");
      },
    };

    await collect(run("hello", freshHistory(), mockRegistry(), llm, SYSTEM));

    expect(capturedHistory[0]).toEqual({ role: "user", content: "hello" });
  });

  it("mutates the passed history so callers retain context across turns", async () => {
    const history = freshHistory();
    const llm = mockLLM([finalAnswer("turn 1"), finalAnswer("turn 2")]);

    await collect(run("first question", history, mockRegistry(), llm, SYSTEM));
    await collect(run("second question", history, mockRegistry(), llm, SYSTEM));

    const userMessages = history.filter((m) => m.role === "user");
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
  });
});
