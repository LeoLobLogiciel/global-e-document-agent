export type AgentEvent =
  | { type: "user_message"; text: string }
  | { type: "thinking"; reasoning: string }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: string; truncated: boolean }
  | { type: "final_answer"; text: string; sources: string[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "iteration_limit_reached"; limit: number }
