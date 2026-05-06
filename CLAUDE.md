# Claude Code Instructions for Document Agent

This file provides persistent context for Claude Code working on this project. Read it before any task.

## Project Overview

A Document Agent: a CLI application where a user asks natural-language questions about a collection of documents (markdown, CSV, plain text, JSON, logs), and an LLM-powered agent answers by reading and reasoning across them.

This is a take-home assignment for a senior AI Engineer role. The evaluation criteria prioritize:
- Custom agent loop (no frameworks like LangChain)
- Multiple typed tools the agent chooses between
- Visible reasoning trace
- Correction memory mechanism
- Clean separation of concerns
- Meaningful tests (not coverage theater)

The full design is in `SPEC.md`. Always read it before implementing anything.

## Language Conventions

**Critical:** All code, comments, identifiers, commit messages, documentation files (README.md, SPEC.md, PROCESS.md, this file), CLI output strings, log messages, and the agent's system prompt MUST be in English.

The user will communicate with you in Spanish (Argentinian). Respond in Spanish for conversation, but produce all artifacts in English. Do not translate technical terms or mix languages in code or documentation.

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript (strict mode)
- **Execution:** `tsx` for development (no build step required)
- **LLM SDK:** `@anthropic-ai/sdk` (official)
- **Schema validation:** `zod`
- **CLI styling:** `chalk`
- **Testing:** `vitest`
- **Env:** `dotenv`

Do not introduce additional dependencies without explicit approval. Especially do not add: any agent framework (LangChain, etc.), vector databases, embeddings libraries, web frameworks, build tools beyond `tsx`.

## Repository Structure

```
document-agent/
├── documents/              # Dataset (read-only at runtime)
│   ├── manifest.json       # Document descriptions for list_documents
│   ├── meetings.md
│   ├── sales-q1.csv
│   ├── emails.txt
│   ├── config.json
│   └── server-log.txt
├── src/
│   ├── agent/
│   │   ├── loop.ts         # The custom agent loop (core of the project)
│   │   ├── events.ts       # AgentEvent discriminated union
│   │   ├── contract.ts     # LLM response schema (zod)
│   │   └── prompt.ts       # System prompt
│   ├── tools/
│   │   ├── registry.ts     # Tool registration and dispatch
│   │   ├── list-documents.ts
│   │   ├── read-document.ts
│   │   ├── apply-correction.ts
│   │   └── list-corrections.ts
│   ├── llm/
│   │   └── client.ts       # Anthropic client wrapper with retry/validation
│   ├── ui/
│   │   └── cli.ts          # CLI renderer (consumes AgentEvent stream)
│   ├── store/
│   │   └── corrections.ts  # Persistent corrections store (JSON file)
│   └── main.ts             # Entry point
├── tests/
│   ├── agent/
│   ├── tools/
│   ├── llm/
│   └── integration/        # Real LLM tests, run separately
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── SPEC.md
├── PROCESS.md
└── CLAUDE.md               # This file
```

## Working Style

### Implementation order

Follow the phases in `SPEC.md` strictly. Do not jump ahead. Each phase ends with a commit.

### Commits

- One logical change per commit
- Imperative mood, English, descriptive: `Add CSV anomaly detection in tools/read-document`
- No emojis in commit messages
- No "WIP" or "fix typo" commits in final history (clean up with rebase if needed)

### Pause points

After completing each of these, **stop and ask the user before proceeding**:

1. After project scaffolding (package.json, tsconfig, deps installed)
2. After implementing types and events
3. After implementing the LLM client (before the loop uses it)
4. After implementing the agent loop with mocked LLM tests passing
5. After integrating the real LLM end-to-end for the first time
6. Before writing the final README

At each pause, summarize what was done, what was tested, and what comes next.

### Decisions

When you encounter a decision point not covered in `SPEC.md`:
1. State the options
2. Recommend one with reasoning
3. Wait for user confirmation before implementing
4. Once confirmed, append a brief entry to `PROCESS.md` describing the decision

Do not silently make architectural decisions.

### Code quality

- Strict TypeScript: no `any`, no implicit returns, no unchecked indexing
- Functions short and single-purpose
- Pure functions where possible (especially in tools)
- Errors are values: prefer `Result<T, E>` patterns or explicit thrown errors with typed catches
- No dead code, no commented-out code, no TODO comments without an associated issue or note in PROCESS.md

### What NOT to do

- Do not create abstractions for hypothetical future needs (no interfaces with single implementations, no factories without multiple products)
- Do not generate boilerplate that isn't directly used
- Do not add logging libraries; `console.log` with chalk is sufficient
- Do not add CI configuration files unless asked
- Do not create example/demo scripts beyond what `SPEC.md` defines
- Do not modify files in `documents/` at runtime (corrections go to a separate file)

## Testing Discipline

- Unit tests use mocked LLM clients (deterministic)
- Integration tests use the real LLM, are marked, and run separately via `npm run test:integration`
- Assertions on LLM output use property-based checks (mentions key terms, calls expected tools), never exact-string matching
- Aim for meaningful coverage of the agent loop, tool dispatch, error paths, and tool implementations — not coverage percentages

## Environment Variables

All read from `.env`, validated at startup with zod, fail fast with a clear message if missing or invalid.

```
ANTHROPIC_API_KEY=sk-ant-...            # required
CLAUDE_MODEL=claude-sonnet-4-5-20250929 # required, default in code if not set
LOG_FILE=agent-trace.log                # optional
MAX_LOOP_ITERATIONS=20                  # optional
```

## Security & Hygiene

- `.env` is in `.gitignore`. Verify before every commit that no real keys are staged.
- `agent-trace.log` and `corrections.json` are in `.gitignore`.
- `documents/` is committed (it's the dataset).
- No secrets, API keys, or PII in code, logs, or commit messages.

## Communication

The user values:
- Direct, concrete answers (no hedging like "you could consider...")
- Trade-offs stated explicitly
- Honest acknowledgment of uncertainty when it exists
- Argentinian Spanish in conversation
- Decisions documented in PROCESS.md as they are made, not retroactively
