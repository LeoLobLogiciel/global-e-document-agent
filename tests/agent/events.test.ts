import { describe, it, expect } from "vitest";
import type { AgentEvent } from "../../src/agent/events.js";

// Compile-time exhaustiveness check: if a new variant is added to AgentEvent
// without updating this switch, TypeScript will error on the default branch.
function classifyEvent(event: AgentEvent): string {
  switch (event.type) {
    case "user_message":
      return event.text;
    case "thinking":
      return event.reasoning;
    case "tool_call":
      return event.toolName;
    case "tool_result":
      return event.result;
    case "final_answer":
      return event.text;
    case "error":
      return event.message;
    case "iteration_limit_reached":
      return String(event.limit);
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

describe("AgentEvent", () => {
  it("user_message carries text", () => {
    const e: AgentEvent = { type: "user_message", text: "hello" };
    expect(classifyEvent(e)).toBe("hello");
  });

  it("thinking carries reasoning", () => {
    const e: AgentEvent = { type: "thinking", reasoning: "let me think" };
    expect(classifyEvent(e)).toBe("let me think");
  });

  it("tool_call carries toolName and args", () => {
    const e: AgentEvent = {
      type: "tool_call",
      toolName: "read_document",
      args: { filename: "meetings.md" },
    };
    expect(classifyEvent(e)).toBe("read_document");
    expect(e.args).toEqual({ filename: "meetings.md" });
  });

  it("tool_result carries truncated flag", () => {
    const e: AgentEvent = {
      type: "tool_result",
      toolName: "read_document",
      result: "some content",
      truncated: false,
    };
    expect(e.truncated).toBe(false);
  });

  it("final_answer carries sources array", () => {
    const e: AgentEvent = {
      type: "final_answer",
      text: "The answer is 42",
      sources: ["meetings.md"],
    };
    expect(e.sources).toHaveLength(1);
  });

  it("error carries recoverable flag", () => {
    const e: AgentEvent = {
      type: "error",
      message: "something went wrong",
      recoverable: false,
    };
    expect(e.recoverable).toBe(false);
  });

  it("iteration_limit_reached carries limit", () => {
    const e: AgentEvent = { type: "iteration_limit_reached", limit: 20 };
    expect(classifyEvent(e)).toBe("20");
  });
});
