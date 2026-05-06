import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";
import type { Tool } from "./registry.js";

export function createReadDocumentTool(documentsDir = "documents"): Tool {
  return {
    name: "read_document",
    description:
      "Read the full contents of a document by filename. Use this when you need the complete text of a specific file.",
    argsSchema: z.object({
      filename: z.string().min(1),
    }),
    async execute(args) {
      const { filename } = args as { filename: string };

      // Prevent path traversal: filename must be a plain name with no directory components
      if (basename(filename) !== filename) {
        return `Invalid filename: "${filename}". Filenames must not contain path separators.`;
      }

      try {
        return readFileSync(join(documentsDir, filename), "utf-8");
      } catch {
        const available = readdirSync(documentsDir)
          .filter((f) => !f.startsWith("."))
          .join(", ");
        return `File not found: "${filename}". Available files: ${available}`;
      }
    },
  };
}
