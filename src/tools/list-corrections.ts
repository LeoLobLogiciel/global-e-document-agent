import { z } from "zod";
import { readCorrections } from "../store/corrections.js";
import type { Tool } from "./registry.js";

export function createListCorrectionsTool(correctionsFile?: string): Tool {
  return {
    name: "list_corrections",
    description:
      "List all corrections recorded so far in this session and previous sessions. Call this at the start of any analysis to ensure you account for known data corrections.",
    argsSchema: z.object({}),
    async execute() {
      const corrections = readCorrections(correctionsFile);
      if (corrections.length === 0) return "No corrections recorded.";

      return corrections
        .map((c) => {
          const affects = c.affects ? `\n  Affects: ${c.affects.join(", ")}` : "";
          return `[${c.id}] ${c.timestamp}\n  ${c.description}${affects}`;
        })
        .join("\n\n");
    },
  };
}
