import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createReadDocumentTool } from "../../src/tools/read-document.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("read_document tool", () => {
  it("reads an existing file and returns its contents", async () => {
    const tool = createReadDocumentTool(fixturesDir);
    const result = await tool.execute({ filename: "notes.txt" });
    expect(result).toContain("sample document");
  });

  it("returns an error message with available files when file not found", async () => {
    const tool = createReadDocumentTool(fixturesDir);
    const result = await tool.execute({ filename: "missing.txt" });
    expect(result).toContain("File not found");
    expect(result).toContain("missing.txt");
    expect(result).toContain("notes.txt");
  });

  it("rejects path traversal attempts", async () => {
    const tool = createReadDocumentTool(fixturesDir);
    const result = await tool.execute({ filename: "../package.json" });
    expect(result).toContain("Invalid filename");
  });

  it("rejects filenames with subdirectory components", async () => {
    const tool = createReadDocumentTool(fixturesDir);
    const result = await tool.execute({ filename: "sub/notes.txt" });
    expect(result).toContain("Invalid filename");
  });
});
