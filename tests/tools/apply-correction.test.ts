import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApplyCorrectionTool } from "../../src/tools/apply-correction.js";
import { readCorrections } from "../../src/store/corrections.js";

function tempFile(): string {
  return join(tmpdir(), `apply-correction-test-${Date.now()}.json`);
}

describe("apply_correction tool", () => {
  let path: string;

  beforeEach(() => {
    path = tempFile();
  });

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path);
  });

  it("returns confirmation message with a UUID", async () => {
    const tool = createApplyCorrectionTool("session-1", path);
    const result = await tool.execute({ description: "Revenue was 95k not 90k" });
    expect(result).toContain("Correction recorded");
    expect(result).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("persists the correction to disk", async () => {
    const tool = createApplyCorrectionTool("session-1", path);
    await tool.execute({ description: "Fix A" });
    const all = readCorrections(path);
    expect(all).toHaveLength(1);
    expect(all[0]?.description).toBe("Fix A");
    expect(all[0]?.session_id).toBe("session-1");
  });

  it("stores the optional affects array", async () => {
    const tool = createApplyCorrectionTool("session-1", path);
    await tool.execute({ description: "Fix B", affects: ["sales-q1.csv"] });
    const all = readCorrections(path);
    expect(all[0]?.affects).toEqual(["sales-q1.csv"]);
  });
});
