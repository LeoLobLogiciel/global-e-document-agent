import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createListCorrectionsTool } from "../../src/tools/list-corrections.js";
import { appendCorrection } from "../../src/store/corrections.js";

function tempFile(): string {
  return join(tmpdir(), `list-corrections-test-${Date.now()}.json`);
}

describe("list_corrections tool", () => {
  let path: string;

  beforeEach(() => {
    path = tempFile();
  });

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path);
  });

  it("returns a no-corrections message when store is empty", async () => {
    const tool = createListCorrectionsTool(path);
    const result = await tool.execute({});
    expect(result).toContain("No corrections");
  });

  it("lists corrections with id, timestamp, and description", async () => {
    appendCorrection({ description: "Revenue fix", session_id: "s1" }, path);
    const tool = createListCorrectionsTool(path);
    const result = await tool.execute({});
    expect(result).toContain("Revenue fix");
    expect(result).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("includes affects when present", async () => {
    appendCorrection(
      { description: "CSV fix", affects: ["sales-q1.csv"], session_id: "s1" },
      path
    );
    const tool = createListCorrectionsTool(path);
    const result = await tool.execute({});
    expect(result).toContain("sales-q1.csv");
  });

  it("lists multiple corrections", async () => {
    appendCorrection({ description: "Fix A", session_id: "s1" }, path);
    appendCorrection({ description: "Fix B", session_id: "s1" }, path);
    const tool = createListCorrectionsTool(path);
    const result = await tool.execute({});
    expect(result).toContain("Fix A");
    expect(result).toContain("Fix B");
  });
});
