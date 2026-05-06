import { describe, it, expect } from "vitest";
import { LLMResponse, ToolCallResponse, FinalAnswerResponse } from "../../src/agent/contract.js";

describe("ToolCallResponse schema", () => {
  const valid = {
    type: "tool_call",
    reasoning: "I need to read the document first",
    tool_name: "read_document",
    tool_args: { filename: "meetings.md" },
  };

  it("accepts a valid tool_call", () => {
    expect(ToolCallResponse.safeParse(valid).success).toBe(true);
  });

  it("rejects empty reasoning", () => {
    expect(ToolCallResponse.safeParse({ ...valid, reasoning: "" }).success).toBe(false);
  });

  it("rejects reasoning over 500 chars", () => {
    expect(
      ToolCallResponse.safeParse({ ...valid, reasoning: "x".repeat(501) }).success
    ).toBe(false);
  });

  it("rejects empty tool_name", () => {
    expect(ToolCallResponse.safeParse({ ...valid, tool_name: "" }).success).toBe(false);
  });

  it("accepts arbitrary tool_args shape", () => {
    const result = ToolCallResponse.safeParse({ ...valid, tool_args: { a: 1, b: [2, 3] } });
    expect(result.success).toBe(true);
  });
});

describe("FinalAnswerResponse schema", () => {
  const valid = {
    type: "final_answer",
    answer: "The meeting decided to refund the webhooks.",
    sources: ["meetings.md"],
  };

  it("accepts a valid final_answer", () => {
    expect(FinalAnswerResponse.safeParse(valid).success).toBe(true);
  });

  it("defaults sources to empty array when omitted", () => {
    const result = FinalAnswerResponse.safeParse({ type: "final_answer", answer: "ok" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toEqual([]);
  });

  it("rejects empty answer", () => {
    expect(FinalAnswerResponse.safeParse({ ...valid, answer: "" }).success).toBe(false);
  });
});

describe("LLMResponse discriminated union", () => {
  it("parses tool_call variant", () => {
    const result = LLMResponse.safeParse({
      type: "tool_call",
      reasoning: "checking docs",
      tool_name: "list_documents",
      tool_args: {},
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("tool_call");
  });

  it("parses final_answer variant", () => {
    const result = LLMResponse.safeParse({
      type: "final_answer",
      answer: "Done.",
      sources: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe("final_answer");
  });

  it("rejects unknown type", () => {
    expect(LLMResponse.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("rejects missing type", () => {
    expect(LLMResponse.safeParse({ answer: "oops" }).success).toBe(false);
  });
});
