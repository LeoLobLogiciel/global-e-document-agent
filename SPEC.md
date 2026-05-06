# SPEC — Document Agent

This document is the design specification for the Document Agent project. It is written before implementation and used to guide it. Decisions made during implementation that diverge from this document must be recorded in `PROCESS.md`.

---

## 1. Problem & Goal

A user asks natural-language questions about a collection of heterogeneous documents (markdown, CSV, plain text, JSON, server logs). An LLM-powered agent reads the documents, reasons across them, and produces grounded answers, optionally accepting user corrections that persist within and across sessions.

### In scope

- Natural-language question answering over a fixed set of documents in `documents/`
- Multi-turn conversation with context retained within a session
- A custom agent loop (orchestration written by hand)
- Multiple typed tools the agent selects from
- Visible trace of the agent's reasoning (which tools called, what found)
- A correction memory mechanism: the user can correct the agent and the correction is applied in subsequent reasoning
- A CLI interface

### Out of scope (deliberate)

- Web frontend, TUI, or graphical interface
- Vector embeddings, semantic search, RAG
- Document upload or modification at runtime
- Multi-user support, authentication
- Streaming token-by-token rendering of the final answer (deferred; implement only if time allows)
- Persistent conversation history across sessions (only corrections persist)
- Agent frameworks (LangChain, CrewAI, etc.) — explicitly forbidden by the assignment
- Auto-generation of document descriptions from content

---

## 2. Core Design Principles

1. **Custom agent loop, no frameworks.** The orchestration is hand-written in a single file and visible in under 150 lines.

2. **Generic agent, specific dataset.** The agent has no hardcoded knowledge of `documents/` contents. It works on whatever files are present, described by a manifest. The dataset shipped with this repo is illustrative, not load-bearing.

3. **Strict separation of concerns.**
   - `agent/` knows nothing about the UI or filesystem
   - `tools/` are pure functions over inputs (some touch the filesystem, but they don't know about the LLM or UI)
   - `ui/` only consumes events and renders them
   The agent emits a stream of typed events; the UI consumes them. Either layer can be swapped.

4. **Strict LLM contracts.** The LLM is instructed to return JSON conforming to a zod schema. Responses that fail validation are rejected with a structured error fed back to the model for correction (one retry).

5. **Defense in depth on errors.** Every external call (LLM, filesystem, parsing) has explicit error handling. The agent never crashes silently and never crashes loudly. All errors become events.

6. **Pragmatism over completeness.** Features that don't fit in the time budget are documented as future work in the README, not partially implemented.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CLI (src/ui/cli.ts)                   │
│  - Reads user input (multi-turn)                         │
│  - Renders AgentEvent stream with chalk                  │
│  - Handles slash commands (exit, clear, corrections)     │
└────────────────────────────▲─────────────────────────────┘
                             │ AgentEvent stream
                             │ (async iterator)
┌────────────────────────────┴─────────────────────────────┐
│             Agent Loop (src/agent/loop.ts)               │
│  - Maintains message history                             │
│  - Calls LLM client                                      │
│  - Validates LLM response against zod contract           │
│  - Dispatches tool calls                                 │
│  - Emits events                                          │
│  - Enforces iteration limit                              │
└──────┬──────────────────────────────────────┬────────────┘
       │                                      │
       │ ToolCall                             │ LLM request
       ▼                                      ▼
┌──────────────────┐              ┌──────────────────────┐
│  Tool Registry   │              │   LLM Client         │
│  (src/tools/)    │              │   (src/llm/client.ts)│
│                  │              │                      │
│  - list_documents│              │  - Anthropic SDK     │
│  - read_document │              │  - Retry on 429/5xx  │
│  - apply_correction│            │  - JSON validation   │
│  - list_corrections│            │  - Timeout handling  │
└────────┬─────────┘              └──────────────────────┘
         │
         ▼
┌──────────────────┐
│  documents/*     │
│  corrections.json│
│  manifest.json   │
└──────────────────┘
```

### Data flow for a single user turn

1. User types a question in CLI
2. CLI calls `agentLoop.run(question)`, which returns an async iterator of `AgentEvent`
3. Loop calls LLM with: system prompt + history + new user message + tool schemas + current corrections
4. LLM returns a JSON response (parsed and validated)
5. If response is `tool_call`: loop dispatches to tool, gets result, appends to history, goes to step 3
6. If response is `final_answer`: loop emits `FinalAnswer` event and returns
7. CLI renders each event as it arrives

---

## 4. LLM Contract

The LLM is constrained to return one of two response shapes, defined as a zod discriminated union:

```typescript
const ToolCallResponse = z.object({
  type: z.literal("tool_call"),
  reasoning: z.string().min(1).max(500),
  tool_name: z.string().min(1),
  tool_args: z.record(z.unknown())
})

const FinalAnswerResponse = z.object({
  type: z.literal("final_answer"),
  answer: z.string().min(1),
  sources: z.array(z.string()).default([])
})

const LLMResponse = z.discriminatedUnion("type", [
  ToolCallResponse,
  FinalAnswerResponse
])
```

### Why a strict contract

- Forces the model to commit to a structure rather than producing free text we then parse heuristically
- Validation failures are caught explicitly and can be retried with feedback
- The `reasoning` field on tool calls gives the user a window into the agent's thinking without exposing raw chain-of-thought
- The `sources` field on final answers enables source citation (grounding)

### How it's enforced

The system prompt instructs the model to respond only in JSON matching the schema, with examples. The first response is validated; on failure, the loop sends back a corrective message ("your previous response did not match the required schema, here is the validation error: ...") and retries once. Two consecutive failures produce an `Error` event.

---

## 5. Tools

Tools are the only way the agent interacts with the world. Each tool has:
- A `name` (string identifier)
- A `description` (used in the system prompt to help the agent choose)
- A zod schema for arguments
- An `execute` function returning a `Result<string, Error>`

The tool registry maps names to tools and provides a `dispatch` function that validates args and invokes execute.

### 5.1 list_documents

**Description:** "List all available documents with a short description of each. Call this first when you need to know what documents exist."

**Args schema:** `z.object({})` (no arguments)

**Returns:** A formatted string with each document's filename and description, read from `documents/manifest.json`.

**Implementation note:** The manifest is a static JSON file mapping filenames to descriptions. In production, this could be auto-generated; here it is hand-written for the included dataset. The manifest is generic data, not hardcoded in the tool.

### 5.2 read_document

**Description:** "Read the full contents of a document by filename. Use this when you need the complete text of a specific file."

**Args schema:**
```typescript
z.object({
  filename: z.string().min(1)
})
```

**Returns:** The raw file contents as a string. No transformation, no parsing, no anomaly stripping. The agent sees what's there.

**Errors:** File not found → returns an error result with the filename and a list of available files (so the agent can self-correct).

### 5.3 apply_correction

**Description:** "Record a correction the user has provided about document data. Use this when the user explicitly tells you that some piece of information you mentioned (or could have inferred) is wrong, and provides the correct value. Corrections persist and will be available in future turns."

**Args schema:**
```typescript
z.object({
  description: z.string().min(1),
  affects: z.array(z.string()).optional()
})
```

**Returns:** Confirmation message including the assigned correction ID.

**Persistence:** Corrections are appended to `corrections.json` in the project root. Each entry has: id (uuid), timestamp (ISO string), description, affects (optional array of filenames), session_id.

### 5.4 list_corrections

**Description:** "List all corrections recorded so far in this session and previous sessions. Call this at the start of any analysis to ensure you account for known data corrections."

**Args schema:** `z.object({})`

**Returns:** Formatted list of corrections, each with id, timestamp, description, and affected files.

**Note:** The system prompt instructs the agent to call this tool early in any non-trivial analysis to ensure corrections are considered.

---

## 6. Agent Events

All communication from the agent loop to the UI uses a typed discriminated union:

```typescript
type AgentEvent =
  | { type: "user_message"; text: string }
  | { type: "thinking"; reasoning: string }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: string; truncated: boolean }
  | { type: "final_answer"; text: string; sources: string[] }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "iteration_limit_reached"; limit: number }
```

The CLI renders each event with appropriate formatting and color. The agent loop emits them via an async generator.

---

## 7. Agent Loop

The loop is the core of the project. It lives in `src/agent/loop.ts` and is no more than ~150 lines.

### Pseudocode

```
async function* run(userMessage, history, tools, llmClient, corrections):
  history.append({ role: "user", content: userMessage })
  yield { type: "user_message", text: userMessage }

  for iteration in 0..MAX_ITERATIONS:
    try:
      raw_response = await llmClient.call(systemPrompt, history, toolSchemas)
    except LLMError as e:
      yield { type: "error", message: e.message, recoverable: false }
      return

    parsed = LLMResponse.safeParse(raw_response)
    if not parsed.success:
      # one retry with feedback
      history.append corrective message
      continue

    response = parsed.data
    history.append({ role: "assistant", content: raw_response })

    if response.type == "final_answer":
      yield { type: "final_answer", text: response.answer, sources: response.sources }
      return

    if response.type == "tool_call":
      yield { type: "thinking", reasoning: response.reasoning }
      yield { type: "tool_call", toolName: response.tool_name, args: response.tool_args }

      tool_result = await tools.dispatch(response.tool_name, response.tool_args)
      yield { type: "tool_result", toolName: response.tool_name, result: tool_result, truncated: ... }

      history.append({ role: "user", content: formatted_tool_result })

  yield { type: "iteration_limit_reached", limit: MAX_ITERATIONS }
```

### Key details

- **History is per-session, not per-turn.** The CLI creates one loop instance per session and calls `run` for each user message, passing the accumulated history.
- **Iteration limit:** 20 by default, configurable. Prevents runaway loops.
- **One JSON validation retry:** if the LLM returns malformed JSON, one corrective message is sent. Two failures abort.
- **Tool errors are not loop errors:** if a tool fails, the failure is reported as a `tool_result` with an error message inside, so the agent can react (e.g., try a different tool).

---

## 8. System Prompt

The system prompt is in `src/agent/prompt.ts` and is its own engineering artifact. Outline:

1. **Role:** "You are a Document Agent. You answer questions about a collection of documents by reading them with tools and reasoning over their contents."

2. **Operating principles:**
   - Always ground answers in document contents. Do not invent facts.
   - When the question is about specific data, read the relevant documents before answering.
   - Cite sources by filename. If a claim comes from `meetings.md`, say so.
   - If the data is insufficient to answer, say so explicitly. Do not guess.
   - Cross-reference documents when a question spans multiple sources.
   - Call `list_corrections` early in any non-trivial analysis. If a correction applies to data you're about to use, account for it.

3. **Output format:** strict JSON matching the schema. Two examples shown (one tool_call, one final_answer).

4. **Tool descriptions:** rendered automatically from the registry.

The full prompt is iterated during implementation. Treat it as code, not as decoration: changes to it are committed and noted in PROCESS.md.

---

## 9. CLI

`src/ui/cli.ts` is the interactive shell.

### Behavior

- On start: prints a banner with project name, model in use, and brief help
- Reads user input line by line via `readline`
- Slash commands:
  - `/exit` or `/quit` — exit
  - `/clear` — reset conversation history (corrections persist)
  - `/corrections` — print all stored corrections
  - `/help` — show available commands
- Any other input is treated as a question to the agent
- Renders events with chalk:
  - `thinking` → dim italic, indented
  - `tool_call` → cyan with `▶` prefix
  - `tool_result` → green with `✓` prefix, truncated to ~200 chars with note
  - `final_answer` → bold white with `📄` prefix, sources listed below
  - `error` → red with `✗` prefix
- Logs all events to `agent-trace.log` in addition to stdout

### Out of scope for CLI

- Streaming token-by-token rendering (the agent receives the full LLM response, then emits events)
- Color themes, configurable layouts
- Mouse interaction, keyboard shortcuts beyond Ctrl-C

---

## 10. Configuration

Read from `.env` (via `dotenv`), validated at startup with zod. If validation fails, the CLI prints a helpful error and exits before any LLM call.

```typescript
const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-5-20250929"),
  LOG_FILE: z.string().default("agent-trace.log"),
  MAX_LOOP_ITERATIONS: z.coerce.number().int().positive().default(20)
})
```

`.env.example` is committed; `.env` is gitignored.

---

## 11. Error Handling

| Source | Failure | Handling |
|--------|---------|----------|
| Missing env var | Startup | Clear error message, exit 1 |
| Invalid env var | Startup | Zod error formatted, exit 1 |
| API key invalid | First LLM call | Error event with explanation, exit cleanly |
| LLM 429 (rate limit) | LLM call | Exponential backoff, up to 3 retries |
| LLM 5xx | LLM call | Single retry after 2s, then fail with error event |
| LLM timeout | LLM call | Single retry, then fail |
| LLM returns invalid JSON | LLM call | One retry with corrective message, then error event |
| LLM returns valid JSON but wrong shape | LLM call | Same as above |
| Unknown tool name | Dispatch | Tool result with error message describing valid tools |
| Tool args fail validation | Dispatch | Tool result with zod error |
| Tool execution throws | Dispatch | Tool result with error message |
| File not found in read_document | Tool exec | Result with error and list of available files |
| Corrections file unreadable | Tool exec | Treat as empty corrections, log warning |
| Iteration limit reached | Loop | Emit dedicated event, return |

The principle: errors at the boundaries become events, not exceptions that crash the program.

---

## 12. Testing Strategy

### Unit tests (most coverage)

All deterministic code, no real LLM calls. Mocked LLM clients return predefined response sequences.

**For the agent loop:**
- Loop dispatches a tool call and feeds the result back into the next LLM call (verifies message construction)
- Loop terminates on `final_answer` and emits the correct event
- Loop respects MAX_ITERATIONS and emits `iteration_limit_reached`
- Loop retries once on invalid JSON and continues
- Loop fails cleanly on a second invalid JSON
- Tool errors flow back to the LLM as `tool_result` events, not exceptions

**For tools:**
- `list_documents` returns the manifest contents
- `read_document` reads a real file from a fixture directory
- `read_document` returns an error result for missing files including the list of available files
- `apply_correction` writes to disk and returns confirmation
- `list_corrections` reads from disk
- `apply_correction` followed by `list_corrections` returns the new entry

**For the LLM client:**
- Successful call returns parsed JSON
- 429 triggers backoff retry
- Invalid JSON triggers retry with corrective message
- Network error after retries returns a typed error

**For config validation:**
- Missing required var fails with clear message
- Invalid number coerces correctly or fails

### Integration tests (few, marked separately)

Run with `npm run test:integration`. These call the real LLM. Skip in regular test runs.

- One test asks a single-document question and verifies:
  - The agent called `read_document` with the relevant file
  - The final answer mentions key terms from the document
  - The response length is reasonable
- One test asks a cross-document question and verifies:
  - The agent called `read_document` at least twice
  - The final answer mentions terms from both documents
- One test simulates a correction:
  - User provides a correction
  - Subsequent question references corrected data
  - Agent's response acknowledges the correction (tested loosely with property assertions)

Property-based assertions only. No exact-string matching on LLM output.

### Tests vs evals

This project ships with tests, not evals. Tests verify code correctness. Evals would verify agent behavior quality across a curated dataset, run periodically against the live agent. Mentioning this distinction in the README signals understanding of the AI engineering domain.

---

## 13. Implementation Phases

Each phase ends with a commit. After phases marked "PAUSE", stop and confirm with the user before proceeding.

### Phase 1 — Scaffolding (PAUSE after)
- `package.json` with deps, scripts (`start`, `test`, `test:integration`)
- `tsconfig.json` strict
- `vitest.config.ts`
- `.env.example`, `.gitignore`
- Empty `src/` and `tests/` structure
- Verify `npm install`, `npm test` (no tests yet, exits 0)

### Phase 2 — Types and contracts (PAUSE after)
- `src/agent/events.ts` — AgentEvent discriminated union
- `src/agent/contract.ts` — LLMResponse zod schemas
- `src/store/corrections.ts` — Correction type and storage interface
- Tests for type exhaustiveness and schema validation

### Phase 3 — Tools
- `src/tools/registry.ts` — registry, dispatch, schema-to-JSON-Schema conversion
- One tool at a time: `list_documents`, `read_document`, `apply_correction`, `list_corrections`
- Each with unit tests

### Phase 4 — LLM client (PAUSE after)
- `src/llm/client.ts` — wraps Anthropic SDK
- Validation, retry, error handling
- Unit tests with mocked SDK

### Phase 5 — Agent loop (PAUSE after)
- `src/agent/loop.ts` — the loop
- `src/agent/prompt.ts` — system prompt
- Unit tests with mocked LLM client

### Phase 6 — End-to-end (PAUSE after)
- `src/ui/cli.ts` — CLI renderer and input loop
- `src/main.ts` — wiring, config validation
- First real run with a real question
- One integration test passing

### Phase 7 — Polish
- Remaining integration tests
- README (PAUSE before writing)
- PROCESS.md final pass
- Verify clean clone runs

---

## 14. Sample Interactions

These are the three examples from the assignment, included here so the agent's expected capabilities are unambiguous. They are also the basis for integration tests and README examples.

1. **Single-document:** "What was decided in the March 12 meeting?"
   - Expected tools: `list_documents`, `read_document(meetings.md)`
   - Expected answer mentions: refund webhooks P1, chargeback P2, pool max increase, alerting threshold

2. **Cross-document:** "Did anyone mention the Q1 sales numbers in the email thread? How do they compare to the actual CSV data?"
   - Expected tools: `list_documents`, `read_document(emails.txt)`, `read_document(sales-q1.csv)`, possibly `list_corrections`
   - Expected answer mentions: dashboard discrepancy, EUR conversion, pending deals, blank units field, refund double-count

3. **Analytical cross-document:** "Are there any errors in the server log that might be related to the config settings?"
   - Expected tools: `list_documents`, `read_document(server-log.txt)`, `read_document(config.json)`
   - Expected answer mentions: API_RATE_LIMITING flag disabled vs rate limit exceeded but allowed through; possibly version mismatch

---

## 15. README Structure (final deliverable)

The README will have:

1. **What this is** — one paragraph
2. **Quick start** — three commands (`npm install`, copy env, `npm start`)
3. **Architecture** — diagram and brief description
4. **Tools** — list with descriptions
5. **How the agent reasons** — explanation of the loop, contract, and trace
6. **Example interactions** — the three sample questions with real captured outputs
7. **Testing strategy** — tests vs evals distinction, what's covered
8. **Design decisions and trade-offs** — explicit choices made and why
9. **What I deliberately did not do and why** — the YAGNI list
10. **How I used AI tools** — honest, specific, per-phase breakdown
11. **Time invested** — honest declaration
12. **If I had more time** — prioritized list

The README is written last, by hand. It should be readable in 5 minutes and convey the design quality without requiring the reader to open any other file.

---

## 16. Definition of Done

The project is done when:

- `git clone <repo> && cd <repo> && npm install && cp .env.example .env && (set ANTHROPIC_API_KEY) && npm start` works on a clean machine
- `npm test` passes
- `npm run test:integration` passes (with API key set)
- README answers all the questions the assignment requires
- No `.env` or secrets in git history
- All commits have descriptive messages
- PROCESS.md reflects real decisions made during development
