import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Tool } from "./registry.js";

export function createListDocumentsTool(documentsDir = "documents"): Tool {
  return {
    name: "list_documents",
    description:
      "List all available documents with a short description of each. Call this first when you need to know what documents exist.",
    argsSchema: z.object({}),
    async execute() {
      const manifest = JSON.parse(
        readFileSync(join(documentsDir, "manifest.json"), "utf-8")
      ) as Record<string, string>;

      return Object.entries(manifest)
        .map(([filename, description]) => `- ${filename}: ${description}`)
        .join("\n");
    },
  };
}
