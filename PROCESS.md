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

<!-- Entries added as work proceeds -->

---

## Phase 3 — Tools

<!-- Entries added as work proceeds -->

---

## Phase 4 — LLM Client

<!-- Entries added as work proceeds -->

---

## Phase 5 — Agent Loop

<!-- Entries added as work proceeds -->

---

## Phase 6 — End-to-End

<!-- Entries added as work proceeds -->

---

## Phase 7 — Polish

<!-- Entries added as work proceeds -->
