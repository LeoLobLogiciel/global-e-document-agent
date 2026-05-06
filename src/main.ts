import "dotenv/config";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createLLMClient } from "./llm/client.js";
import { createRegistry } from "./tools/registry.js";
import { createListDocumentsTool } from "./tools/list-documents.js";
import { createReadDocumentTool } from "./tools/read-document.js";
import { createApplyCorrectionTool } from "./tools/apply-correction.js";
import { createListCorrectionsTool } from "./tools/list-corrections.js";
import { buildSystemPrompt } from "./agent/prompt.js";
import { startCLI } from "./ui/cli.js";

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-5-20250929"),
  LOG_FILE: z.string().default("agent-trace.log"),
  MAX_LOOP_ITERATIONS: z.coerce.number().int().positive().default(20),
});

function loadConfig() {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Configuration error:\n${issues}`);
    console.error("\nCopy .env.example to .env and fill in the required values.");
    process.exit(1);
  }
  return result.data;
}

function main() {
  const config = loadConfig();
  const sessionId = crypto.randomUUID();

  const sdk = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const llmClient = createLLMClient(sdk, {
    model: config.CLAUDE_MODEL,
    timeoutMs: 60000,
  });

  const registry = createRegistry([
    createListDocumentsTool(),
    createReadDocumentTool(),
    createApplyCorrectionTool(sessionId),
    createListCorrectionsTool(),
  ]);

  const systemPrompt = buildSystemPrompt(registry.tools);

  startCLI({
    llmClient,
    registry,
    systemPrompt,
    maxIterations: config.MAX_LOOP_ITERATIONS,
    logFile: config.LOG_FILE,
    model: config.CLAUDE_MODEL,
  });
}

main();
