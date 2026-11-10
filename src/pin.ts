/**
 * Pin file: proof that a specific model id + prompt set + baseline run
 * were locked together at a point in time.
 *
 *   {
 *     "model": "claude-fable-5.1",
 *     "promptSetSha256": "<sha256 of the canonical prompt set>",
 *     "baselineRunSha256": "<sha256 of the baseline run file bytes>",
 *     "createdAt": "2026-11-10T07:00:00.000Z"
 *   }
 *
 * The prompt-set hash is computed over a canonical JSON document:
 * records sorted by id, each reduced to {id, prompt}. Reordering the
 * run file does not change it; changing any prompt text does.
 * The baseline-run hash is over the raw file bytes, so it also pins
 * the exact recorded outputs.
 */
import { createHash } from "node:crypto";
import type { RunRecord } from "./runfile.js";

export interface PinFile {
  model: string;
  promptSetSha256: string;
  baselineRunSha256: string;
  createdAt: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Canonical prompt-set document: sorted by id, {id, prompt} only. */
export function canonicalPromptSet(records: RunRecord[]): string {
  const pairs = records
    .map((r) => ({ id: r.id, prompt: r.prompt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(pairs);
}

export function promptSetSha256(records: RunRecord[]): string {
  return sha256Hex(canonicalPromptSet(records));
}

export function createPin(
  model: string,
  records: RunRecord[],
  baselineRunBytes: string,
): PinFile {
  return {
    model,
    promptSetSha256: promptSetSha256(records),
    baselineRunSha256: sha256Hex(baselineRunBytes),
    createdAt: new Date().toISOString(),
  };
}

export function parsePin(text: string, sourceName: string): PinFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${sourceName}: not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${sourceName}: pin must be a JSON object.`);
  }
  const p = parsed as Record<string, unknown>;
  for (const field of ["model", "promptSetSha256", "baselineRunSha256", "createdAt"]) {
    if (typeof p[field] !== "string" || (p[field] as string) === "") {
      throw new Error(`${sourceName}: pin is missing a string "${field}".`);
    }
  }
  return parsed as unknown as PinFile;
}
