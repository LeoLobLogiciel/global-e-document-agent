/**
 * Integration tests — call the real LLM. Require ANTHROPIC_API_KEY in .env.
 * Run with: npm run test:integration
 * Excluded from: npm test
 *
 * All assertions are property-based. No exact-string matching on LLM output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLLMClient } from "../../src/llm/client.js";
import { createRegistry } from "../../src/tools/registry.js";
import { createListDocumentsTool } from "../../src/tools/list-documents.js";
import { createReadDocumentTool } from "../../src/tools/read-document.js";
import { createApplyCorrectionTool } from "../../src/tools/apply-correction.js";
import { createListCorrectionsTool } from "../../src/tools/list-corrections.js";
import { buildSystemPrompt } from "../../src/agent/prompt.js";
import { run } from "../../src/agent/loop.js";
import type { AgentEvent } from "../../src/agent/events.js";
import type { Message } from "../../src/llm/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const documentsDir = join(__dirname, "../../documents");

function setup() {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const sdk = new Anthropic({ apiKey });
  const llmClient = createLLMClient(sdk, {
    model: process.env["CLAUDE_MODEL"] ?? "claude-sonnet-4-5-20250929",
    timeoutMs: 60000,
  });
  const registry = createRegistry([
    createListDocumentsTool(documentsDir),
    createReadDocumentTool(documentsDir),
    createApplyCorrectionTool("integration-test"),
    createListCorrectionsTool(),
  ]);
  const systemPrompt = buildSystemPrompt(registry.tools);
  return { llmClient, registry, systemPrompt };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

// ── Test 1: Single-document ───────────────────────────────────────────────────

describe("single-document question", () => {
  beforeAll(() => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.warn("ANTHROPIC_API_KEY not set — integration tests will be skipped");
    }
  });

  it("answers the March 12 meeting question correctly", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const { llmClient, registry, systemPrompt } = setup();
    const history: Message[] = [];
    const events = await collect(
      run(
        "What was decided in the March 12 meeting?",
        history,
        registry,
        llmClient,
        systemPrompt
      )
    );

    // Agent must have read meetings.md
    const readCalls = events.filter(
      (e) => e.type === "tool_call" && e.toolName === "read_document"
    );
    expect(readCalls.length).toBeGreaterThanOrEqual(1);
    const readMeetings = readCalls.find(
      (e) => e.type === "tool_call" && e.args["filename"] === "meetings.md"
    );
    expect(readMeetings).toBeDefined();

    // Final answer must be present and reasonable
    const fa = events.find((e) => e.type === "final_answer");
    expect(fa).toBeDefined();
    if (fa?.type !== "final_answer") return;

    expect(fa.text.length).toBeGreaterThan(100);
    expect(fa.text.length).toBeLessThan(3000);
    expect(fa.sources).toContain("meetings.md");

    // At least 2 of the known decision keywords must appear
    const keywords = ["refund", "chargeback", "pool", "alert", "webhook"];
    const text = fa.text.toLowerCase();
    const hits = keywords.filter((k) => text.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  }, 90_000);
});

// ── Test 2: Cross-document ────────────────────────────────────────────────────

describe("cross-document question", () => {
  it("compares email thread mentions with actual CSV data", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const { llmClient, registry, systemPrompt } = setup();
    const history: Message[] = [];
    const events = await collect(
      run(
        "Did anyone mention the Q1 sales numbers in the email thread? How do they compare to the actual CSV data?",
        history,
        registry,
        llmClient,
        systemPrompt
      )
    );

    // Agent must have called read_document at least twice
    const readCalls = events.filter(
      (e) => e.type === "tool_call" && e.toolName === "read_document"
    );
    expect(readCalls.length).toBeGreaterThanOrEqual(2);

    // Final answer must cite both source files
    const fa = events.find((e) => e.type === "final_answer");
    expect(fa).toBeDefined();
    if (fa?.type !== "final_answer") return;

    expect(fa.sources).toContain("emails.txt");
    expect(fa.sources).toContain("sales-q1.csv");

    // At least 2 of the known cross-document keywords must appear
    const keywords = ["eur", "pending", "blank", "refund", "sarah", "lopez", "discrepan"];
    const text = fa.text.toLowerCase();
    const hits = keywords.filter((k) => text.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  }, 90_000);
});
