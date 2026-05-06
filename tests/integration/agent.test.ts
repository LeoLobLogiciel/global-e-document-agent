/**
 * Integration tests — require a real ANTHROPIC_API_KEY.
 * Run with: npm run test:integration
 *
 * Assertions are property-based (key terms, tool usage patterns).
 * No exact-string matching on LLM output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const documentsDir = join(__dirname, "../../documents");

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function setup(correctionsFile?: string) {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — skipping integration tests");

  const sdk = new Anthropic({ apiKey });
  const llmClient = createLLMClient(sdk, {
    model: process.env["CLAUDE_MODEL"] ?? "claude-sonnet-4-5-20250929",
    timeoutMs: 60000,
  });

  const registry = createRegistry([
    createListDocumentsTool(documentsDir),
    createReadDocumentTool(documentsDir),
    createApplyCorrectionTool("integration-test", correctionsFile),
    createListCorrectionsTool(correctionsFile),
  ]);

  const systemPrompt = buildSystemPrompt(registry.tools);
  return { llmClient, registry, systemPrompt };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration — single-document question", () => {
  beforeAll(() => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.warn("Skipping: ANTHROPIC_API_KEY not set");
    }
  });

  it("answers a question about the March meeting using meetings.md", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const { llmClient, registry, systemPrompt } = setup();
    const history: Message[] = [];
    const events = await collect(
      run("What was decided in the March 12 meeting?", history, registry, llmClient, systemPrompt)
    );

    // Agent must have called read_document with meetings.md
    const toolCalls = events.filter((e) => e.type === "tool_call");
    const readCall = toolCalls.find(
      (e) => e.type === "tool_call" && e.toolName === "read_document"
    );
    expect(readCall).toBeDefined();
    if (readCall?.type === "tool_call") {
      expect(readCall.args["filename"]).toBe("meetings.md");
    }

    // Final answer must mention key decision terms from the document
    const fa = events.find((e) => e.type === "final_answer");
    expect(fa).toBeDefined();
    if (fa?.type === "final_answer") {
      const text = fa.text.toLowerCase();
      // At least one of the known decisions must appear
      const knownTerms = ["webhook", "chargeback", "pool", "alert", "threshold"];
      expect(knownTerms.some((t) => text.includes(t))).toBe(true);
      expect(fa.sources).toContain("meetings.md");
    }
  }, 120_000);
});

describe("integration — cross-document question", () => {
  it("compares email mentions of Q1 sales with the actual CSV data", async () => {
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

    // Agent must have read both emails.txt and sales-q1.csv
    const readCalls = events
      .filter((e) => e.type === "tool_call" && e.toolName === "read_document")
      .map((e) => e.type === "tool_call" && e.args["filename"]);

    expect(readCalls).toContain("emails.txt");
    expect(readCalls).toContain("sales-q1.csv");

    const fa = events.find((e) => e.type === "final_answer");
    expect(fa).toBeDefined();
    if (fa?.type === "final_answer") {
      const text = fa.text.toLowerCase();
      const knownTerms = ["dashboard", "discrepanc", "eur", "refund", "unit", "blank"];
      expect(knownTerms.some((t) => text.includes(t))).toBe(true);
    }
  }, 120_000);
});

describe("integration — correction workflow", () => {
  it("records a correction and acknowledges it in the response", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const corrFile = join(tmpdir(), `integration-corrections-${Date.now()}.json`);
    try {
      const { llmClient, registry, systemPrompt } = setup(corrFile);
      const history: Message[] = [];
      const events = await collect(
        run(
          "The Q1 revenue figure in the CSV is wrong — the correct total is 95,000, not whatever is shown.",
          history,
          registry,
          llmClient,
          systemPrompt
        )
      );

      // Agent must have called apply_correction
      const correctionCall = events.find(
        (e) => e.type === "tool_call" && e.toolName === "apply_correction"
      );
      expect(correctionCall).toBeDefined();

      // Final answer must acknowledge the correction
      const fa = events.find((e) => e.type === "final_answer");
      expect(fa).toBeDefined();
      if (fa?.type === "final_answer") {
        const text = fa.text.toLowerCase();
        expect(text).toMatch(/correct|record|noted|updat/);
      }
    } finally {
      if (existsSync(corrFile)) unlinkSync(corrFile);
    }
  }, 120_000);
});
