import * as readline from "node:readline";
import * as fs from "node:fs";
import chalk from "chalk";
import { run } from "../agent/loop.js";
import type { AgentEvent } from "../agent/events.js";
import type { LLMClient, Message } from "../llm/client.js";
import type { Registry } from "../tools/registry.js";

export type CLIOptions = {
  llmClient: LLMClient;
  registry: Registry;
  systemPrompt: string;
  maxIterations: number;
  logFile: string;
  model: string;
};

const TOOL_RESULT_DISPLAY_CHARS = 200;

function printBanner(model: string) {
  console.log(chalk.bold.cyan("\n╔══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║        Document Agent  v1.0.0        ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════╝"));
  console.log(chalk.dim(`  Model : ${model}`));
  console.log(chalk.dim("  /help for commands, Ctrl-C to exit\n"));
}

function printHelp() {
  console.log(chalk.yellow("Commands:"));
  console.log(chalk.yellow("  /help         — show this message"));
  console.log(chalk.yellow("  /corrections  — list all stored corrections"));
  console.log(chalk.yellow("  /clear        — reset conversation (corrections kept)"));
  console.log(chalk.yellow("  /exit /quit   — exit\n"));
}

function renderEvent(event: AgentEvent, logStream: fs.WriteStream | null) {
  let line = "";

  switch (event.type) {
    case "user_message":
      line = chalk.bold(`\nYou: ${event.text}`);
      break;
    case "thinking":
      line = chalk.dim.italic(`  ↳ ${event.reasoning}`);
      break;
    case "tool_call":
      line = chalk.cyan(`  ▶ ${event.toolName}(${JSON.stringify(event.args)})`);
      break;
    case "tool_result": {
      const preview =
        event.result.length > TOOL_RESULT_DISPLAY_CHARS
          ? event.result.slice(0, TOOL_RESULT_DISPLAY_CHARS) + chalk.dim(" …[truncated]")
          : event.result;
      line = chalk.green(`  ✓ ${preview}`);
      break;
    }
    case "final_answer": {
      console.log(chalk.bold.white(`\n📄 ${event.text}`));
      if (event.sources.length > 0) {
        console.log(chalk.dim(`   Sources: ${event.sources.join(", ")}`));
      }
      console.log();
      logStream?.write(JSON.stringify(event) + "\n");
      return;
    }
    case "error":
      line = chalk.red(`  ✗ ${event.message}`);
      break;
    case "iteration_limit_reached":
      line = chalk.yellow(`  ⚠ Reached iteration limit (${event.limit}). Try a more specific question.`);
      break;
  }

  console.log(line);
  logStream?.write(JSON.stringify(event) + "\n");
}

export function startCLI(options: CLIOptions) {
  const { llmClient, registry, systemPrompt, maxIterations, logFile, model } = options;

  const logStream = logFile
    ? fs.createWriteStream(logFile, { flags: "a" })
    : null;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let history: Message[] = [];

  printBanner(model);
  printHelp();

  const prompt = () => rl.question(chalk.bold.green("You › "), handleInput);

  async function handleInput(input: string) {
    const trimmed = input.trim();

    if (!trimmed) {
      prompt();
      return;
    }

    // ── Slash commands ──────────────────────────────────────────────────────
    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log(chalk.dim("Goodbye."));
      logStream?.end();
      rl.close();
      return;
    }

    if (trimmed === "/help") {
      printHelp();
      prompt();
      return;
    }

    if (trimmed === "/clear") {
      history = [];
      console.log(chalk.dim("Conversation cleared. Corrections are still active.\n"));
      prompt();
      return;
    }

    if (trimmed === "/corrections") {
      const result = await registry.dispatch("list_corrections", {});
      console.log(chalk.yellow("\nStored corrections:"));
      console.log(result);
      console.log();
      prompt();
      return;
    }

    // ── Agent turn ──────────────────────────────────────────────────────────
    try {
      const events = run(trimmed, history, registry, llmClient, systemPrompt, maxIterations);
      for await (const event of events) {
        renderEvent(event, logStream);
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ Unexpected error: ${String(err)}`));
    }

    prompt();
  }

  rl.on("close", () => {
    console.log(chalk.dim("\nGoodbye."));
    logStream?.end();
    process.exit(0);
  });

  prompt();
}
