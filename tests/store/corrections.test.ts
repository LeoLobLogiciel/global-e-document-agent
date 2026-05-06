import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCorrections, appendCorrection } from "../../src/store/corrections.js";

function tempFile(): string {
  return join(tmpdir(), `corrections-test-${Date.now()}-${Math.random()}.json`);
}

describe("readCorrections", () => {
  it("returns empty array when file does not exist", () => {
    expect(readCorrections("/nonexistent/path/corrections.json")).toEqual([]);
  });

  it("returns empty array when file is empty or malformed", () => {
    const path = tempFile();
    // Write invalid JSON
    import("node:fs").then(({ writeFileSync }) => writeFileSync(path, "not json"));
    expect(readCorrections(path)).toEqual([]);
  });
});

describe("appendCorrection", () => {
  let path: string;

  beforeEach(() => {
    path = tempFile();
  });

  afterEach(() => {
    if (existsSync(path)) unlinkSync(path);
  });

  it("creates the file and returns a correction with id and timestamp", () => {
    const result = appendCorrection(
      { description: "Q1 revenue was 95k not 90k", session_id: "test-session" },
      path
    );

    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    expect(result.description).toBe("Q1 revenue was 95k not 90k");
    expect(result.session_id).toBe("test-session");
  });

  it("persists the correction so readCorrections returns it", () => {
    appendCorrection(
      { description: "fix A", session_id: "s1" },
      path
    );
    const all = readCorrections(path);
    expect(all).toHaveLength(1);
    expect(all[0]?.description).toBe("fix A");
  });

  it("accumulates multiple corrections", () => {
    appendCorrection({ description: "fix A", session_id: "s1" }, path);
    appendCorrection({ description: "fix B", session_id: "s1" }, path);
    appendCorrection({ description: "fix C", session_id: "s2" }, path);

    const all = readCorrections(path);
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.description)).toEqual(["fix A", "fix B", "fix C"]);
  });

  it("stores optional affects array", () => {
    appendCorrection(
      { description: "fix", affects: ["sales-q1.csv"], session_id: "s1" },
      path
    );
    const all = readCorrections(path);
    expect(all[0]?.affects).toEqual(["sales-q1.csv"]);
  });

  it("assigns unique ids to each correction", () => {
    appendCorrection({ description: "A", session_id: "s" }, path);
    appendCorrection({ description: "B", session_id: "s" }, path);
    const all = readCorrections(path);
    expect(all[0]?.id).not.toBe(all[1]?.id);
  });
});
