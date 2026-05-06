import { z } from "zod";

export const ToolCallResponse = z.object({
  type: z.literal("tool_call"),
  reasoning: z.string().min(1).max(500),
  tool_name: z.string().min(1),
  tool_args: z.record(z.unknown()),
});

export const FinalAnswerResponse = z.object({
  type: z.literal("final_answer"),
  answer: z.string().min(1),
  sources: z.array(z.string()).default([]),
});

export const LLMResponse = z.discriminatedUnion("type", [
  ToolCallResponse,
  FinalAnswerResponse,
]);

export type ToolCallResponse = z.infer<typeof ToolCallResponse>;
export type FinalAnswerResponse = z.infer<typeof FinalAnswerResponse>;
export type LLMResponse = z.infer<typeof LLMResponse>;
