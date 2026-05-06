# PROCESS — Development Log

This document captures real decisions made during the implementation of the Document Agent. Entries are added as decisions are made, not retroactively. The intent is to make the design process visible alongside the final code, so a reader can see not just what was built but why.

Each entry follows this loose structure:
- **Decision:** what was chosen
- **Context:** the problem being addressed
- **Alternatives considered:** other options weighed
- **Trade-off accepted:** what is given up by this choice

---

## Pre-implementation

### Decision: Redacted Slack webhook URL in config.json
**Context:** GitHub's push protection blocked the original webhook URL because it matches the format of a Slack incoming webhook (even though the value contains placeholder zeros and X's). The block fires on format, not on validity.
**Alternatives considered:** Use GitHub's "allow secret" override (rejected: leaves a record on the repo's security tab that suggests negligence); rename the field (rejected: changes the structure of a dataset I was given); use a clearly fake URL like `https://hooks.slack.example/...` (rejected: still triggers the detector).
**Trade-off accepted:** Replaced the URL with the literal string "REDACTED". This loses some realism in the dataset but does not affect any of the three sample questions in the assignment. Documented here for transparency.

### Decision: Node.js + TypeScript over Python
**Context:** The assignment allows any language. Python is conventionally associated with AI/ML work, but personal fluency in Node/TypeScript is significantly higher.
**Alternatives considered:** Python with FastAPI; C# (also a working language).
**Trade-off accepted:** Python's slightly richer ecosystem of LLM examples is given up in exchange for higher implementation velocity within a tight time budget. The Anthropic TypeScript SDK is first-class, so there is no functional disadvantage.

### Decision: CLI over web frontend or TUI
**Context:** The assignment explicitly accepts "even a simple CLI."
**Alternatives considered:** TUI with Ink (rejected: cost in time vs marginal benefit, plus risk of terminal compatibility issues at evaluation); web frontend (rejected: out of scope, adds fragility to deployment).
**Trade-off accepted:** Visual polish is reduced. Mitigated by careful use of chalk, Unicode symbols, and clear formatting.

### Decision: Strict JSON contract for LLM responses, validated with zod
**Context:** The agent needs to interpret model output reliably. The Anthropic SDK supports tool_use natively, but a hand-built contract demonstrates explicit handling of LLM unreliability.
**Alternatives considered:** Native tool_use blocks from the SDK (less defensive); free-text parsing (brittle).
**Trade-off accepted:** Slight loss of model fluency from constraining output to JSON, in exchange for explicit validation, retry on malformed output, and a single source of truth for the response schema.

### Decision: Four core tools, no specialized parsers
**Context:** The agent could be given specialized tools for parsing CSV, JSON, or logs. The dataset is small enough that the agent can reason directly over raw file contents.
**Alternatives considered:** Adding `query_csv`, `parse_json_path`, `analyze_logs` as separate tools.
**Trade-off accepted:** The agent does more reasoning per query rather than offloading to deterministic parsers. This keeps the surface area small and the architecture honest about what the agent is doing. Specialized parsers would be appropriate at larger scale.

### Decision: Persistent corrections via JSON file, not in-memory only
**Context:** The "exceptional" criterion mentions a correction mechanism. Persistence makes the feature realistic.
**Alternatives considered:** In-memory only (lost on restart); database (overkill).
**Trade-off accepted:** Simple file-based storage with no concurrency control. Acceptable because there is one user, one process.

---

## Phase 1 — Scaffolding

### Decision: `"type": "module"` (ESM) in package.json
**Context:** Node.js 20 has stable, first-class ESM support. The choice between CJS and ESM affects import syntax, interop with chalk v5, and vitest config.
**Alternatives considered:** CommonJS (`"type": "commonjs"`) — avoids ESM edge cases but requires `.cjs` workarounds for ESM-only deps; hybrid (CJS source + ESM output) — unnecessary complexity.
**Trade-off accepted:** A small number of CJS-only packages become harder to consume. In practice, all chosen deps (`@anthropic-ai/sdk`, `chalk` v5, `zod`, `dotenv`, `tsx`, `vitest`) are ESM-compatible. Chalk v5 is ESM-only, so this choice is effectively required to use it.

### Decision: `"moduleResolution": "bundler"` in tsconfig
**Context:** tsx uses esbuild internally, which behaves like a bundler (resolves imports without requiring explicit `.js` extensions). `"node16"` or `"nodenext"` would require `.js` extension on every relative import, which is noisy and unfamiliar for most TypeScript codebases.
**Alternatives considered:** `"node16"` (correct for pure Node.js ESM, but requires extension-qualified imports); `"node"` (legacy, doesn't model ESM correctly).
**Trade-off accepted:** If the project were ever built with `tsc` for distribution (not the plan — tsx is the runtime), the output might not match Node's module resolution exactly. Acceptable because `dist/` is never published.

### Decision: `noUncheckedIndexedAccess: true` in tsconfig
**Context:** Prevents silent `undefined` from array and object index access — a common source of runtime errors with LLM-returned data.
**Alternatives considered:** Omit the flag (default strict mode does not include it). This would allow `arr[0]` without a defined-check, which is unsafe for API responses.
**Trade-off accepted:** Slightly more verbose index access (requires explicit nullchecks). Worth it given that tool outputs and LLM responses are the primary data structures being indexed.

### Decision: Pin to specific dep versions via `^` (caret), not `=` (exact)
**Context:** The project has no lockfile committed yet. Using `^` allows patch and minor updates while keeping semver compatibility.
**Alternatives considered:** Exact pins (brittle for a take-home, adds noise to diffs); `~` (tilde, patch-only — overly cautious).
**Trade-off accepted:** Theoretically a minor bump could break something. Mitigated by the fact that `npm install` generates a lockfile that is committed, locking the tree from that point forward.

---

## Phase 2 — Types and Contracts

### Decision: Injectable file path in corrections store
**Context:** The SPEC defines `corrections.json` as the persistence target but does not specify how tests should interact with it. Hardcoding the path would require tests to either write to the real file or mock `fs`.
**Alternatives considered:** Mocking `node:fs` in tests (rejected: couples tests to implementation details and requires extra setup); using a fixed temp path per test run (fragile if tests run in parallel).
**Trade-off accepted:** `readCorrections` and `appendCorrection` accept an optional `filePath` parameter defaulting to `"corrections.json"`. Tests pass a unique temp file path per test case. Production callers use the default. This is a minimal surface change that makes the store purely functional over its input.

### Decision: `crypto.randomUUID()` instead of a `uuid` package
**Context:** Each correction needs a unique ID. The `uuid` npm package is the conventional choice, but Node 20 ships `crypto.randomUUID()` as a stable built-in.
**Alternatives considered:** `uuid` package (adds a dependency for something already in the runtime); `Date.now() + Math.random()` (not collision-safe enough for a persistent store).
**Trade-off accepted:** None meaningful. `crypto.randomUUID()` produces RFC 4122 v4 UUIDs, is cryptographically random, and requires zero additional dependencies. Strictly better than the alternative given Node 20 as the minimum runtime.

### Decision: `noUncheckedIndexedAccess` validated in practice
**Context:** This flag was enabled in Phase 1 as a precaution against silent `undefined` from array indexing. Phase 2 tests confirmed it has real impact: every array access in test assertions required optional chaining (`all[0]?.description` rather than `all[0].description`).
**Alternatives considered:** Disabling the flag to reduce verbosity (rejected: the verbosity is the point — it forces explicit handling of potentially-undefined values, which matters when indexing LLM-returned arrays).
**Trade-off accepted:** Slightly more verbose test assertions. The flag stays enabled.

---

## Phase 3 — Tools

### Decision: Keep path traversal guard added by Claude Code in read_document
**Context:** Claude Code added a `basename(filename) !== filename` check in `read_document` that was not in the SPEC. This guards against path traversal attacks (`../../../etc/passwd`).
**Alternatives considered:** Remove the check (the LLM only uses filenames from the manifest, so the threat is theoretical in this context); keep it (defense in depth, costs only 3 lines).
**Trade-off accepted:** Kept the guard. Worth noting: Claude Code made this design decision unilaterally despite CLAUDE.md instructing it to pause for confirmation on decisions outside the SPEC. Reinforced the pause requirement before continuing to Phase 4.

### Decision: Synchronous fs operations in corrections store, no atomicity
**Context:** The corrections store reads and writes a JSON file. In production this would need atomicity (write-via-rename), file locking for multi-process safety, and zod validation on read.
**Alternatives considered:** Implement full robustness (atomic writes, locking, validation) — appropriate for production; implement minimum viable persistence — appropriate for single-user CLI.
**Trade-off accepted:** Minimum viable persistence chosen. Single-user, single-process context makes the simpler approach correct here. Documented as future work for production use.

### Process note: PR-style review of Claude Code output

**Context:** Claude Code reported Phase 3 (4 tools + tests) complete in 3 minutes. This was suspiciously fast, raising the possibility of stub implementations or trivial tests.
**Approach:** Paused before approving the phase. Requested full source of registry, read_document, apply_correction, and corrections store, plus the test output. Reviewed each file as if it were a pull request from a contributor: checked for real implementation vs stubs, meaningful test assertions vs tautologies, error handling, and unilateral design choices.
**Outcome:** All code was real and well-implemented (45 tests passing). One unilateral design decision was caught (path traversal guard, see entry above). The review took ~10 minutes and would have taken much longer to debug if discovered later.
**Trade-off accepted:** A small time investment in review per phase, in exchange for catching issues early and maintaining trust in the codebase.

---

## Phase 4 — LLM Client

### Decision: One retry on 5xx without re-entering the 429 backoff loop
**Context:** The LLM client handles 5xx errors with a single retry after 2s, 
but if that retry also returns a 5xx or a 429, it's treated as a generic 
error rather than re-entering the 429 backoff loop.
**Alternatives considered:** Implement a unified retry loop that handles 
any retryable error type with exponential backoff (more correct but more 
complex); accept the current behavior as "good enough" for the rare edge 
case of cascading errors.
**Trade-off accepted:** Current implementation. The probability of a 5xx 
followed by a 429 in two consecutive calls is low. Documented as a known 
limitation; would refactor for production use.

### Decision: 60-second timeout on LLM calls
**Context:** The Anthropic SDK defaults to a 10-minute timeout, which 
is excessive for an interactive agent. A user waiting 10 minutes for 
a response would assume the system has hung.
**Alternatives considered:** Use the SDK default (10 min — too long); 
shorter timeout like 30s (might fail on legitimately slow responses); 
no timeout (worst, can hang indefinitely).
**Trade-off accepted:** 60 seconds. Long enough for any reasonable LLM 
response (responses in this agent are short JSON, typically < 5s), 
short enough to fail fast when something is wrong. Configurable via 
LLMClientConfig.timeoutMs for tests or special cases.
---

## Phase 5 — Agent Loop

### Decision: Iterated on system prompt after first version had structural issues

**Context:** Claude Code's first version of buildSystemPrompt had three issues: 
examples showed multiple JSONs as if they were a single response (would break 
the contract), no example for the correction workflow, and no example for 
"insufficient data" scenarios.

**Approach:** Caught the issues during review (instinct flagged them as 
"feels off" before I could articulate why). Asked Claude Code for a 
specific list of changes rather than a vague "make it better."

**Outcome:** Second version explicitly marks each turn ("Your first turn", 
"After seeing the tool result"), includes three examples covering the main 
patterns (single-doc, correction, insufficient data), and ties operating 
principles to demonstrated behavior.

**Trade-off accepted:** ~10 minutes of iteration. Worth it because the system 
prompt is the agent's "brain" — bugs here cause behavioral problems that 
are harder to debug than code bugs.
---

## Phase 6 — End-to-End

### Phase 6 — Observation: LLMs are unreliable at arithmetic

**Context:** During end-to-end testing, asked the agent to compute Sarah 
Lopez's total Q1 revenue. The agent correctly retrieved all 7 deals, 
correctly computed each line item (units × price), and correctly applied 
a previously-recorded correction. However, the final sum was incorrect 
($5,416 reported vs $7,424 actual).

**Root cause:** This is not a bug in the agent code or the dataset. LLMs 
generate tokens that look like sums but do not actually perform arithmetic 
operations. Sums of multiple numbers are particularly unreliable.

**What I did NOT do:** add a calculator tool or code-execution tool. These 
would solve the problem but expand scope beyond what the assignment 
requires.

**Documented as:** known limitation, mentioned in README under "Limitations" 
and "Future work" sections. Production agents handling numeric workloads 
should delegate arithmetic to a deterministic tool.

### Phase 6 — Verified: LLM arithmetic is task-dependent

**Observation:** Tested the same arithmetic operation in two contexts.
- In a complex query (retrieve + reason + correct + format + sum), 
  the agent gave wrong total: $5,416 vs correct $7,424.
- In an isolated query ("calculate this sum"), the agent gave correct 
  $7,424 and proactively corrected its previous error.

**Conclusion:** Sonnet 4.5 can perform arithmetic reliably when focused 
on it as the sole task. Accuracy degrades when arithmetic is one of 
many simultaneous operations the model must orchestrate.

**Implication for production:** Delegate critical arithmetic to a 
deterministic tool. For descriptive output where small inaccuracies 
are tolerable, inline computation is acceptable.

**Decision for this exercise:** Documented as known limitation. Did not 
add a calculator tool to keep scope focused on agent loop, tools, and 
correction memory.

### Decision: No automated tests for CLI rendering

**Context:** The CLI layer (src/ui/cli.ts) has no unit tests, while every 
other layer does.

**Alternatives considered:** Mock readline + capture stdout assertions (high 
complexity, low value); snapshot tests of rendered output (brittle to chalk 
version changes).

**Trade-off accepted:** The CLI is thin orchestration over the agent loop 
and the renderEvent function. The agent loop is heavily tested (14 tests). 
The render logic is straightforward switch + chalk calls. Manual end-to-end 
verification (the sample runs in docs/sample-runs/) confirms behavior. 
Adding CLI tests would be coverage theater.

### Decision: Single composition root in main.ts

**Context:** All construction (SDK instantiation, client wrapping, tool 
registration, prompt building) happens in main.ts. No globals, no 
singletons, no service locators.

**Alternatives considered:** Hidden global instances; per-module 
initialization with module-level state; dependency injection container.

**Trade-off accepted:** A small amount of "wiring code" in main.ts in 
exchange for explicit dependency flow. Reading main.ts gives a complete 
mental model of how the system is assembled. Easy to swap any layer 
(different SDK, different storage backend) by changing only main.ts.

### Phase 6 — End-to-end verification complete

**Outcome:** All three sample questions from the assignment work 
correctly: single-document, cross-document, and analytical cross-document. 
The correction mechanism works end-to-end including persistence across 
sessions. Identified one limitation (LLM arithmetic in complex queries) 
documented separately.

**What was tested:**
- Three sample questions with full trace and citations
- apply_correction round-trip (record, persist, read in new session)
- Cross-session correction usage (agent applies corrections from 
  previous session in new analysis)
- Slash commands (/exit, /clear, /corrections, /help)
- Configuration validation (missing API key produces clear error)

**Test artifacts:** docs/sample-runs/01-06 (six captured interactions 
demonstrating different aspects of agent behavior).


---

## Phase 7 — Polish

### Decision: Actionable error messages in LLM client instead of technical dumps
**Context:** Initial error messages exposed raw SDK internals (e.g. "LLM API error 401: ..."). A user running the CLI would see these and have no idea what to do. The CLI renders them directly via the `error` AgentEvent — there is no error-handling layer between the client and the screen.
**Alternatives considered:** Generic fallback message for all errors (simpler, but loses the signal); expose raw SDK message only (already the status quo, already bad); structured error codes for programmatic handling (overkill for a CLI).
**Trade-off accepted:** Each HTTP status class and network error code gets a distinct message with a concrete next step. The original SDK message is preserved as context for auth and model errors (where the raw detail is still useful) but dropped for transient errors (rate limit, 5xx) where the fix is always the same. No new tests written — testing that a switch produces a specific string would be pure coverage theater.

---

## README notes (raw, processed in Phase 7)

This is a scratch list of things that should appear in the final README, captured during development to avoid forgetting them. Not structured prose — just bullets to be polished later.

### Setup / requirements
- Node 20+ tested, also confirmed working on Node 24.13
- Anthropic API key required (separate from claude.ai subscription)
- Approximate cost to run: under $5 USD with normal usage

### Design decisions worth highlighting
- Custom agent loop, ~150 lines, deliberately framework-free
- Strict JSON contract via zod, with one retry on malformed output
- Four tools chosen over many specialized parsers (deliberate scope)
- Corrections persist to disk, not just in memory
- Generic agent over included dataset (not hardcoded for it)

### Process / how AI was used
- Cross-validated design with both Claude (web) and ChatGPT before coding
- Treated Claude Code output as PR contributions: review before commit
- Caught at least one unilateral decision (path traversal guard in read_document)
- Used CLAUDE.md for persistent project context with Claude Code
- Used SPEC.md as the source of truth that Claude Code consults

### Trade-offs accepted (for "What I did not do" section)
- No semantic search / embeddings (corpus too small to justify)
- No streaming token-by-token rendering of final answer
- No multi-process safety on corrections store
- No TUI (CLI with chalk is sufficient for the demo)
- No second UI built (architecture supports it, time spent elsewhere)

### Things to verify before submitting
- Clone in clean directory, run from scratch
- Verify .env.example is present and .env is gitignored
- Confirm npm test passes from clean install
- Confirm npm start works without errors
- Run the three sample questions and capture output

### Things to mention as "future work"
- Atomic writes for corrections store
- Streaming responses
- Eval suite separate from tests
- Auto-generation of manifest descriptions

### Evidence of AI tool supervision
- Phase 3 review caught path traversal guard added without consultation
- Tracked time per phase to validate Claude Code is not skipping work
- Documented decisions in PROCESS.md as they happened, not retroactively

### Limitations to mention
- LLM arithmetic unreliability: agent correctly retrieves and reasons 
  over data, but multi-number sums can be incorrect. Verified during 
  testing. Mitigation in production: delegate arithmetic to a calculator 
  or code-execution tool.

  ## A real observation about LLM behavior

During end-to-end testing, I asked the agent to compute Sarah Lopez's 
total Q1 revenue across 7 deals. The agent correctly retrieved each deal, 
correctly applied a previously-recorded correction, but reported an 
incorrect final sum ($5,416 instead of $7,424).

When asked to compute the same sum in isolation 
("Calculate: 1470 + 693 + ..."), the agent gave the correct answer 
and apologized for the previous error.

This illustrates a property of LLM-based agents: arithmetic accuracy 
degrades when the model is performing many simultaneous tasks 
(retrieve + reason + apply correction + format + sum). For production 
systems requiring numerical precision, the right pattern is to delegate 
arithmetic to a deterministic tool (calculator or code execution) 
rather than rely on the LLM's inline computation.

I deliberately did not implement such a tool in this exercise because 
it would expand scope beyond the assignment, but it would be the first 
addition I'd make for a production version.

## Honest assessment: where the agent stumbles

During end-to-end testing I observed an arithmetic error: when asked 
to compute total revenue across 7 line items, the agent retrieved each 
correctly, applied a recorded correction correctly, but reported an 
incorrect sum ($5,416 vs actual $7,424).

Asked the same arithmetic in isolation, the agent computed it correctly 
and apologized for the prior error. This points to a property of LLM 
agents: arithmetic accuracy degrades during complex multi-task responses.

For production, I would add a calculator tool the agent could delegate 
to. I deliberately did not implement this here to keep scope focused 
on the assignment's core: agent loop, tools, and correction memory.

See `docs/sample-runs/06-arithmetic-limitation.txt` for the full trace.Te p