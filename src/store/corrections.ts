import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type Correction = {
  id: string;
  timestamp: string;
  description: string;
  affects?: string[];
  session_id: string;
};

export function readCorrections(filePath = "corrections.json"): Correction[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Correction[];
  } catch {
    return [];
  }
}

export function appendCorrection(
  data: { description: string; affects?: string[]; session_id: string },
  filePath = "corrections.json"
): Correction {
  const existing = readCorrections(filePath);
  const entry: Correction = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...data,
  };
  existing.push(entry);
  writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
  return entry;
}
