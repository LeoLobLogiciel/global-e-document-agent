import { z } from "zod";
import { appendCorrection } from "../store/corrections.js";
import type { Tool } from "./registry.js";

export function createApplyCorrectionTool(
  sessionId: string,
  correctionsFile?: string
): Tool {
  return {
    name: "apply_correction",
    description:
      "Record a correction the user has provided about document data. Use this when the user explicitly tells you that some piece of information you mentioned (or could have inferred) is wrong, and provides the correct value. Corrections persist and will be available in future turns.",
    argsSchema: z.object({
      description: z.string().min(1),
      affects: z.array(z.string()).optional(),
    }),
    async execute(args) {
      const { description, affects } = args as {
        description: string;
        affects?: string[];
      };
      const correction = appendCorrection(
        { description, session_id: sessionId, ...(affects !== undefined && { affects }) },
        correctionsFile
      );
      return `Correction recorded with ID: ${correction.id}`;
    },
  };
}
