# Document Agent

A natural-language Q&A agent over a small collection of heterogeneous documents (markdown notes, CSV data, plain-text emails, JSON config, server logs). Built with a custom agent loop — no LangChain, no agent frameworks — for a senior AI Engineer take-home.

Built by **Leo Lob**.

---

## Quick start

```bash
git clone https://github.com/LeoLobLogiciel/global-e-document-agent.git
cd global-e-document-agent
npm install
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
npm start
```

Then ask questions interactively:

```
You › What was decided in the March 12 meeting?
```

Slash commands available: `/help`, `/corrections`, `/clear`, `/exit`.

### Requirements

- Node.js 20 or higher (tested on 20.x and 24.13)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
  — note this is a **separate** product from a claude.ai subscription; the API has its own billing
- ~$1–5 USD of API credit covers normal usage of this project comfortably

### Running the tests

```bash
npm test                    # 70 unit tests, ~600ms, no LLM calls
npm run test:integration    # 2 integration tests, ~35s, hits the real LLM
```

---

## What this is

A user types a natural-language question. The agent reads the relevant documents using a small set of tools, reasons across them, and returns an answer with cited sources. The agent's reasoning is visible as a live trace. Corrections the user provides are persisted to disk and applied to future analyses, even across sessions.

The point of the exercise was to demonstrate how I design and build LLM-powered systems — the orchestration, the contracts, the trade-offs, the supervision of AI-assisted code — not to maximize features. The README is in the same spirit: longer than necessary because it shows the reasoning behind the choices.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CLI (src/ui/cli.ts)                   │
│  Reads user input. Renders AgentEvent stream with chalk. │
│  Handles slash commands. Logs to file.                   │
└────────────────────────────▲─────────────────────────────┘
                             │ AgentEvent stream
                             │ (async iterator)
┌────────────────────────────┴─────────────────────────────┐
│             Agent Loop (src/agent/loop.ts)               │
│  Maintains message history. Calls LLM. Validates JSON    │
│  contract. Dispatches tool calls. Emits typed events.    │
│  Enforces iteration limit. ~120 lines.                   │
└──────┬──────────────────────────────────────┬────────────┘
       │                                      │
       ▼                                      ▼
┌──────────────────┐              ┌──────────────────────┐
│  Tool Registry   │              │   LLM Client         │
│  (src/tools/)    │              │   (src/llm/client.ts)│
│                  │              │                      │
│  list_documents  │              │  Anthropic SDK       │
│  read_document   │              │  Retry on 429/5xx    │
│  apply_correction│              │  JSON validation     │
│  list_corrections│              │  60s timeout         │
└────────┬─────────┘              └──────────────────────┘
         │
         ▼
   documents/* + corrections.json + manifest.json
```

Three layers, strict separation:

- **`agent/`** knows nothing about the UI or filesystem. It receives a `Registry` and an `LLMClient` as dependencies and emits typed events.
- **`tools/`** are pure functions over their inputs. They don't know about the LLM or the loop.
- **`ui/`** consumes events and renders them. The CLI is one consumer; another (web, TUI, voice) could be added without touching the agent.

The composition root is `src/main.ts`. Everything is wired there. No globals, no service locators, no hidden initialization.

---

## How the agent reasons

The agent works through a small loop:

1. Receive a user message
2. Send the conversation (system prompt + history) to the LLM
3. Validate the response against a strict JSON contract (zod)
4. If the response is a `tool_call`: dispatch to the tool, capture the result, append it to history, go to step 2
5. If the response is a `final_answer`: emit it, end the turn

The LLM is constrained to return one of two response shapes:

```typescript
{ type: "tool_call",    reasoning, tool_name, tool_args }
{ type: "final_answer", answer, sources }
```

If the model returns malformed JSON, the loop sends back a corrective message ("your previous response was not valid JSON, here is the validation error: ...") and retries once. Two consecutive failures abort the turn with an error event. The HTTP layer (in the LLM client) handles 429 with exponential backoff and 5xx with a single retry, all separately from the JSON validation.

Each step of the loop emits a typed event (`thinking`, `tool_call`, `tool_result`, `final_answer`, `error`, `iteration_limit_reached`). The CLI renders them in real time, so the user can watch the agent decide what to read, see what it found, and read the synthesis. The full trace also goes to `agent-trace.log`.

---

## Tools

Four tools, deliberately minimal:

| Tool | What it does |
|------|--------------|
| `list_documents` | Returns the list of available documents with descriptions, read from `documents/manifest.json` |
| `read_document` | Reads the raw contents of a document by filename |
| `apply_correction` | Records a user-provided correction to disk, with description, optional affected files, and a generated UUID |
| `list_corrections` | Returns all stored corrections (across sessions) |

I deliberately **didn't** add specialized parsers (no `query_csv`, no `parse_json`, no `analyze_logs`). The dataset is small enough that the agent can read raw files and reason over them. Adding more tools would have moved work out of the agent and into deterministic code, which is the wrong direction for an exercise about agent capability.

The `read_document` tool always returns the raw file content — no cleaning, no anomaly stripping. This matters because part of what the agent should do is detect anomalies (blank fields in the CSV, format inconsistencies, version mismatches between config and log). Pre-processing those out would defeat the purpose.

---

## Example interactions

I tested the agent end-to-end with the three sample questions from the assignment, plus a correction workflow that exercises persistence across sessions. The full traces are in `docs/sample-runs/`. Highlights below.

### Single-document question

> **"What was decided in the March 12 meeting?"**

The agent calls `list_documents`, then `read_document(meetings.md)`, then synthesizes a structured answer:

```
📄 In the March 12, 2026 meeting, the following decisions were made:

1. Refund webhooks are P1, chargeback handling is P2 (post-freeze) — After
   discovering undocumented Adyen webhook event types, the team prioritized
   refund webhooks as must-have before feature freeze, while deferring
   chargeback handling to after the freeze.

2. Connection pool max increased from 20 to 50 — This was implemented as a
   temporary fix to address the server stability issues that caused two
   outages the previous weekend.

3. David to add alerting on pool utilization > 80% — To prevent future
   connection pool exhaustion issues.

   Sources: meetings.md
```

Full trace: `docs/sample-runs/01-march-meeting.txt`

### Cross-document question

> **"Did anyone mention the Q1 sales numbers in the email thread? How do they compare to the actual CSV data?"**

The agent reads `emails.txt`, then `sales-q1.csv`, then proactively calls `list_corrections` (because the system prompt instructs it to before any non-trivial analysis). It produces a comparison that mentions the EUR conversion issue, the three pending deals, the blank `units_sold` field for Sarah Lopez's deal, and the Feb 14 refund being double-counted.

Full trace: `docs/sample-runs/02-cross-document-q1.txt`

### Analytical cross-document question

> **"Are there any errors in the server log that might be related to the config settings?"**

The agent reads `server-log.txt` and `config.json`, and produces what is essentially a small audit report identifying four cross-cutting issues: API rate limiting disabled in config but rate limit exceeded in log; connection pool exhaustion correlating with config pool max; unhandled chargeback webhooks tied back to a meeting decision; and a config/deployment version mismatch (`2.14.3` vs deployed `2.14.4`).

The agent cited three sources (`server-log.txt`, `config.json`, `meetings.md`) — the third pulled from prior context in the same session, which I found impressive.

Full trace: `docs/sample-runs/03-config-vs-log.txt`

### Correction workflow with persistence across sessions

This is the part of the exercise the rubric calls "exceptional". The flow:

1. User asks for Sarah Lopez's total revenue. Agent notices `units_sold` is blank for her Feb 22 deal and reports the limitation honestly.
2. User provides the correction: "the Feb 22 deal was 2 units at $499, total $998". Agent calls `apply_correction`, records it to `corrections.json`, and recomputes.
3. User exits the CLI completely.
4. User restarts the CLI (new session, new sessionId, empty conversation history).
5. User asks "What corrections do you have on record?" — agent retrieves and lists the previous correction.
6. User asks again about Sarah Lopez's revenue. Agent calls `list_corrections` (per the system prompt's instruction to do so for non-trivial analysis), sees the recorded correction, and applies it automatically — without the user mentioning it.

Full traces: `docs/sample-runs/04-sarah-lopez-revenue.txt`, `05-correction-persistence.txt`.

---

## Honest assessment: where the agent stumbles

While testing the correction flow, I found a real failure that's worth describing because it points at a property of LLM-based agents.

The agent had to compute Sarah Lopez's total Q1 revenue across 7 line items. It correctly retrieved each deal, correctly applied the recorded correction for the Feb 22 row, and produced a well-structured answer — but the final sum was wrong: $5,416 reported, $7,424 actual.

When I asked the same arithmetic in isolation ("Calculate: 1470 + 693 + 882 + 1078 + 998 + 1372 + 931"), the agent gave the correct answer ($7,424) and proactively apologized for the previous error.

This isn't a bug in the agent code or the dataset. It's a property of LLMs: arithmetic accuracy degrades when the model is performing many simultaneous tasks (retrieve + reason + apply correction + format + sum). When focused on the arithmetic alone, it's reliable.

For production, the right pattern is to delegate arithmetic to a deterministic tool (calculator or code execution). I deliberately didn't implement that here — it would expand scope past the assignment's core. But it would be the first addition I'd make for a production version. See `docs/sample-runs/06-arithmetic-limitation.txt`.

I'm calling this out because I think detecting and explaining this kind of failure is more valuable than hiding it.

---

## Testing strategy

There are two kinds of testing in this project, separated on purpose.

**Unit tests (`npm test`)**: 70 tests, ~600ms. The LLM is mocked. Coverage focuses on:

- Agent loop behavior (tool dispatch, JSON validation, retry on malformed output, iteration limit, error propagation) — 14 tests
- Tool implementations (each tool's happy path and failure modes)
- LLM client (HTTP retry, backoff, JSON parse retry with corrective message)
- Schema validation (the LLM contract and AgentEvent shapes)
- Corrections store (read/write round-trip, missing-file handling)

Mocked tests are deterministic and fast. They run on every change.

**Integration tests (`npm run test:integration`)**: 2 tests, ~35s. The real LLM is called. Assertions are property-based (the agent called `read_document` with the right file, the answer mentions key terms, the sources are cited correctly) — never exact-string matching against LLM output, which would be brittle.

Integration tests live in `tests/integration/` and use a separate vitest config (`vitest.integration.config.ts`) so they only run when explicitly invoked. They're not in CI by default.

### Tests vs evals

This project ships tests, not evals. I want to call out the distinction because I think it matters in AI engineering.

**Tests** verify code correctness — that the agent loop, tools, and validation logic behave as designed.

**Evals** verify agent behavior quality across a curated dataset of question/expected-behavior pairs, run periodically to detect regressions in agent quality (not code quality). They use property-based or LLM-as-judge scoring rather than exact matching.

Both are valuable for a production agent. I didn't build an eval harness here because the scope was implementation, not benchmarking. It would be the second thing I'd add for production.

---

## Design decisions worth calling out

### Strict JSON contract instead of native tool_use

The Anthropic SDK has first-class support for tool use as native message blocks. I chose instead to constrain the model to return JSON validated by a zod schema. Why: it makes the agent's contract with the model explicit and inspectable, makes the validation/retry logic auditable, and makes the response shape a single source of truth that produces both runtime validation and TypeScript types.

There's a cost: forcing JSON output may slightly degrade the model's response quality compared to free-form generation. In practice, the responses are good and the explicit contract makes the system more debuggable.

### Generic agent over a specific dataset

The agent has no hardcoded knowledge of what's in `documents/`. It works on whatever files are present, described by `manifest.json`. The dataset shipped with this repo is illustrative — if you replace the files (and update the manifest), the agent works on the new corpus without code changes.

I emphasized this because part of an AI engineer's job is to design systems that generalize, not pipelines that solve one demo.

### Persistent corrections, not in-memory only

Corrections are written to `corrections.json` on disk, with UUID + timestamp + session ID. They survive across sessions. The system prompt instructs the agent to call `list_corrections` at the start of any non-trivial analysis, so corrections are applied automatically in future turns without the user having to remember.

Trade-off: no atomicity guarantees, no file locking. Acceptable for single-user CLI; would need write-via-rename and zod validation on read for multi-process safety.

### Single composition root

All construction (SDK instantiation, client wrapping, tool registration, prompt building, CLI startup) happens in `src/main.ts` — about 25 lines. No globals, no singletons, no DI containers. Reading `main.ts` gives a complete mental model of how the system is assembled. Swapping any layer (different LLM provider, different storage backend) is a `main.ts` edit.

### Strict TypeScript

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`. During Phase 7 cleanup, running `tsc --noEmit` caught two latent type bugs the runtime tests didn't surface. Strict TypeScript pays for itself, especially when handling LLM-returned data where shapes can drift.

---

## What I deliberately did not build, and why

- **Vector embeddings / semantic search / RAG.** The corpus is five files. Adding a vector store would be infrastructure for a problem this project doesn't have. At ~50+ documents I'd reconsider.
- **Web frontend.** The assignment explicitly accepts a CLI. A web UI would have eaten the time budget for marginal evaluation gain.
- **TUI with Ink.** Considered briefly. A polished CLI with chalk gives most of the visual benefit at a fraction of the complexity, with no terminal-compatibility risk at evaluation time.
- **A second UI implementation.** The architecture supports it (the agent emits typed events, any consumer can render them), but I chose to spend the time on testing and the correction mechanism instead. I mention this in case the evaluator wants to see the separation in code rather than just in design.
- **Token-by-token streaming of the final answer.** The Anthropic SDK supports it, but the agent's responses are short and arrive fast enough that the UX gain is marginal. Would add for production.
- **Multi-process safety on the corrections store.** Read-modify-write is not atomic. For single-user CLI this is fine; for shared use I'd switch to write-via-rename.
- **A calculator or code-execution tool.** Would solve the arithmetic limitation described above. Deliberately out of scope.
- **An eval harness.** Different beast from tests. Important for production agents, out of scope here.

I documented every one of these as a conscious decision rather than letting them be silent omissions.

---

## How I used AI tools

This is the section I most want to be honest about, because the assignment explicitly asks and because I think misrepresenting it would be a bad signal.

**The honest summary:** Claude Code (Anthropic's terminal coding agent) wrote most of the implementation code under my direction. I designed the architecture, wrote the SPEC before any code was written, defined the contracts and event shapes, made every architectural decision, reviewed every batch of generated code before commit, caught issues, and pushed back when something wasn't right. I treated each batch of generated code as a pull request from a contributor, not as final output.

### What I did manually

- Read the entire dataset before writing any spec, identifying the cross-document inferences the agent should be capable of detecting (config/log version mismatch, rate limiting flag vs log, etc.)
- Wrote `SPEC.md` (the full design doc) end-to-end before opening Claude Code
- Wrote `CLAUDE.md` (Claude Code's persistent project context) with explicit rules: pause after each phase, document decisions in PROCESS.md as they happen, no scope expansion without confirmation, English in code regardless of conversation language
- Made every architectural decision: stack choice, event shape, JSON contract design, tool surface, separation of concerns, testing strategy, what to build and what to defer
- Iterated on the system prompt manually after the first generated version had structural issues (examples concatenated as if a single response, missing correction workflow example)
- Reviewed the code at every phase boundary — sometimes catching real issues (a path traversal guard added without consulting me, an arithmetic bug the agent itself produced during testing)
- Wrote `PROCESS.md` entries in real time as decisions happened, not retroactively
- Wrote this README

### Where Claude Code did the heavy lifting

- All the actual TypeScript implementation following the SPEC
- All the unit tests, written alongside each component
- Integration test scaffolding
- Phase-by-phase commits with descriptive messages
- Found and fixed two latent type errors during Phase 7 by running `tsc --noEmit` (a step I hadn't explicitly asked for, but a good one)

### What this looked like in practice

I worked in a parallel setup: Claude Code in the terminal for code, the Claude web app for design discussion. When I needed to think through a trade-off, I'd discuss it in the web app. When the decision was made, I'd hand it to Claude Code with specific instructions. I also cross-checked some of the early architectural decisions against ChatGPT to reduce single-AI bias — useful exercise even though I went with the design Claude and I had converged on.

I used a model mix to be deliberate about cost and quality: Sonnet 4.5 for most coding tasks, the more capable Opus tier for harder design decisions and the SPEC. This is a real consideration for production AI work and I treated the exercise as a chance to practice it.

The total estimated API spend during development was under $5 USD across all interactions.

### What I want to convey

I think the most important skill in AI-assisted engineering today is **not "writing more code with AI"** — it's **knowing what to ask for, what to accept, and what to push back on**. The 35+ years of experience I bring to software work is exactly what makes that supervision useful. The AI is fast; the criterion of what's good is mine.

If you read the commit history, the PROCESS.md entries, and this README, I think the supervision is visible. That's the part that's me.

---

## Time invested

Approximately **3.5 hours** end-to-end, slightly above the suggested 2–3 hour budget. The extra time went to:

- Reading the dataset carefully before writing the SPEC (~20 min) — informed the cross-document examples and the choice to make the agent generic over the dataset
- Writing the SPEC and CLAUDE.md (~45 min) before any code — made the implementation phase straightforward
- Phase-by-phase code review (~30 min total spread across all phases) — caught the issues mentioned above
- Capturing real sample runs and writing this README (~45 min)

I made a deliberate choice to invest those extra ~30 minutes because the assignment explicitly evaluates "how effectively you use [AI] tools" and "how you arrived at the answer", which to me means showing the design and review process, not just shipping minimum-viable code. I'd rather submit something with one extra sample run and a thorough README than five extra features and a thin one.

If I had to do it in 2 hours flat, I'd cut: the second integration test, two of the six sample runs, and most of the "what I didn't build" section. The core would be intact.

---

## Limitations and future work

In rough priority order:

1. **Calculator / code-execution tool** to solve the LLM arithmetic problem (described above)
2. **Eval harness** with a curated question/expected-behavior dataset, to catch regressions in agent quality
3. **Atomic writes for the corrections store** (write-via-rename), enabling multi-process safe usage
4. **Streaming token-by-token rendering** of the final answer for better perceived latency on long responses
5. **Auto-generation of manifest descriptions** (currently the manifest is hand-written) using an LLM summarization step at index time
6. **Cancellable in-flight requests** via AbortController — currently Ctrl-C kills the process

Beyond these: a web frontend, a second UI to demonstrate the architecture's flexibility, a richer correction model with structured fields, semantic search if the corpus grows, and a more sophisticated logger if the trace becomes a real product surface.

---

## Project structure

```
document-agent/
├── documents/                  # Dataset (read-only at runtime)
│   ├── manifest.json
│   └── *.md, *.csv, *.txt, *.json
├── src/
│   ├── agent/
│   │   ├── loop.ts             # The custom agent loop
│   │   ├── events.ts           # AgentEvent discriminated union
│   │   ├── contract.ts         # LLM response schema (zod)
│   │   └── prompt.ts           # System prompt builder
│   ├── tools/
│   │   ├── registry.ts         # Tool registration + dispatch
│   │   ├── list-documents.ts
│   │   ├── read-document.ts
│   │   ├── apply-correction.ts
│   │   └── list-corrections.ts
│   ├── llm/
│   │   └── client.ts           # Anthropic SDK wrapper
│   ├── store/
│   │   └── corrections.ts      # Persistent corrections store
│   ├── ui/
│   │   └── cli.ts              # Interactive CLI
│   └── main.ts                 # Composition root
├── tests/
│   ├── agent/                  # 33 unit tests
│   ├── tools/                  # 19 unit tests
│   ├── llm/                    # 11 unit tests
│   ├── store/                  # 7 unit tests
│   └── integration/            # 2 integration tests (LLM real)
├── docs/sample-runs/           # 6 captured end-to-end interactions
├── SPEC.md                     # Design specification (written first)
├── PROCESS.md                  # Decisions log (written during)
├── CLAUDE.md                   # Persistent context for Claude Code
└── README.md                   # This file
```

---

Thanks for reading. I'm happy to walk through any part of the code or design in a follow-up conversation.
