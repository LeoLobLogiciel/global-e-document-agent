import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createListDocumentsTool } from "../../src/tools/list-documents.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("list_documents tool", () => {
  it("returns a formatted list from the manifest", async () => {
    const tool = createListDocumentsTool(fixturesDir);
    const result = await tool.execute({});
    expect(result).toContain("notes.txt");
    expect(result).toContain("data.csv");
    expect(result).toContain("General project notes");
    expect(result).toContain("Sample sales data");
  });

  it("formats each entry with a dash prefix", async () => {
    const tool = createListDocumentsTool(fixturesDir);
    const result = await tool.execute({});
    const lines = result.split("\n");
    expect(lines.every((l) => l.startsWith("- "))).toBe(true);
  });

  it("throws when manifest is missing", async () => {
    const tool = createListDocumentsTool("/nonexistent/path");
    await expect(tool.execute({})).rejects.toThrow();
  });
});
