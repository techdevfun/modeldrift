/**
 * Deterministic diff engine: compare two recorded runs of the same prompts.
 *
 * Signals only - no LLM judge, no quality scoring. A prompt verdict says
 * outputs differ and how, never whether the new output is better or worse.
 *
 * Verdict priority for a matched prompt (first match wins):
 *   1. REFUSAL-FLIP   - one side refuses, the other does not (phrase list).
 *   2. STRUCTURE-FLIP - JSON validity flips on a prompt that asks for JSON.
 *   3. LENGTH-DRIFT   - length ratio exceeds the threshold (default 50%).
 *   4. CHANGED        - normalized output differs.
 *   5. IDENTICAL      - normalized output is equal.
 * Prompts present on one side only: NEW (current only) / REMOVED (baseline only).
 */
import { normalizeOutput, type RunRecord } from "./runfile.js";
import { isRefusal } from "./refusal.js";

export type PromptVerdict =
  | "IDENTICAL"
  | "CHANGED"
  | "REFUSAL-FLIP"
  | "LENGTH-DRIFT"
  | "STRUCTURE-FLIP"
  | "NEW"
  | "REMOVED";

export interface PromptDiff {
  id: string;
  verdict: PromptVerdict;
  baselineLength: number | null;
  currentLength: number | null;
  /** Signed character delta (current - baseline), null for NEW/REMOVED. */
  lengthDelta: number | null;
  /** Length ratio |new - old| / max(old, 1), null for NEW/REMOVED. */
  lengthRatio: number | null;
  detail: string;
}

export interface DiffSummary {
  total: number;
  matched: number;
  identical: number;
  changed: number;
  refusalFlips: number;
  lengthDrifts: number;
  structureFlips: number;
  added: number;
  removed: number;
  changedPercent: number;
  /** Median signed length delta across matched prompts. */
  medianLengthDelta: number;
  verdict: "STABLE" | "DRIFT DETECTED";
}

export interface DiffResult {
  prompts: PromptDiff[];
  summary: DiffSummary;
}

export interface DiffOptions {
  /** Changed-% threshold for the overall verdict (default 0). */
  thresholdPercent?: number;
  /** Length-ratio threshold for LENGTH-DRIFT (default 0.5). */
  lengthThreshold?: number;
}

export function lengthRatio(oldLen: number, newLen: number): number {
  return Math.abs(newLen - oldLen) / Math.max(oldLen, 1);
}

/** True when the prompt asks for JSON output (or either output looks JSON-shaped). */
export function wantsJson(prompt: string, baselineOut: string, currentOut: string): boolean {
  if (/json/i.test(prompt)) return true;
  const looksJson = (s: string) => {
    const t = s.trim();
    return t.startsWith("{") || t.startsWith("[");
  };
  return looksJson(baselineOut) || looksJson(currentOut);
}

export function parsesAsJson(output: string): boolean {
  try {
    JSON.parse(output);
    return true;
  } catch {
    return false;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function diffRuns(
  baseline: RunRecord[],
  current: RunRecord[],
  options: DiffOptions = {},
): DiffResult {
  const thresholdPercent = options.thresholdPercent ?? 0;
  const lengthThreshold = options.lengthThreshold ?? 0.5;

  const baseById = new Map(baseline.map((r) => [r.id, r]));
  const curById = new Map(current.map((r) => [r.id, r]));
  const ids = [...new Set([...baseById.keys(), ...curById.keys()])].sort();

  const prompts: PromptDiff[] = [];
  const deltas: number[] = [];

  for (const id of ids) {
    const b = baseById.get(id);
    const c = curById.get(id);
    if (b === undefined && c !== undefined) {
      prompts.push({
        id,
        verdict: "NEW",
        baselineLength: null,
        currentLength: c.output.length,
        lengthDelta: null,
        lengthRatio: null,
        detail: "prompt only in the current run",
      });
      continue;
    }
    if (c === undefined && b !== undefined) {
      prompts.push({
        id,
        verdict: "REMOVED",
        baselineLength: b.output.length,
        currentLength: null,
        lengthDelta: null,
        lengthRatio: null,
        detail: "prompt only in the baseline run",
      });
      continue;
    }
    // Matched prompt.
    const baseOut = b!.output;
    const curOut = c!.output;
    const baseLen = baseOut.length;
    const curLen = curOut.length;
    const delta = curLen - baseLen;
    const ratio = lengthRatio(baseLen, curLen);
    deltas.push(delta);

    const baseRefusal = isRefusal(baseOut);
    const curRefusal = isRefusal(curOut);
    const baseJson = parsesAsJson(baseOut);
    const curJson = parsesAsJson(curOut);

    let verdict: PromptVerdict;
    let detail: string;
    if (baseRefusal !== curRefusal) {
      verdict = "REFUSAL-FLIP";
      detail = curRefusal
        ? "baseline complies, current refuses"
        : "baseline refuses, current complies";
    } else if (
      baseJson !== curJson &&
      wantsJson(b!.prompt, baseOut, curOut)
    ) {
      verdict = "STRUCTURE-FLIP";
      detail = curJson
        ? "baseline is not valid JSON, current is valid JSON"
        : "baseline is valid JSON, current is not valid JSON";
    } else if (ratio > lengthThreshold) {
      verdict = "LENGTH-DRIFT";
      detail = `length ${baseLen} -> ${curLen} chars (ratio ${(ratio * 100).toFixed(0)}% > ${(lengthThreshold * 100).toFixed(0)}%)`;
    } else if (normalizeOutput(baseOut) !== normalizeOutput(curOut)) {
      verdict = "CHANGED";
      detail = `output differs (length ${baseLen} -> ${curLen} chars)`;
    } else {
      verdict = "IDENTICAL";
      detail = "output identical after normalization";
    }
    prompts.push({
      id,
      verdict,
      baselineLength: baseLen,
      currentLength: curLen,
      lengthDelta: delta,
      lengthRatio: ratio,
      detail,
    });
  }

  const matched = prompts.filter((p) => p.verdict !== "NEW" && p.verdict !== "REMOVED").length;
  const identical = prompts.filter((p) => p.verdict === "IDENTICAL").length;
  const changed = prompts.length - identical;
  const refusalFlips = prompts.filter((p) => p.verdict === "REFUSAL-FLIP").length;
  const lengthDrifts = prompts.filter((p) => p.verdict === "LENGTH-DRIFT").length;
  const structureFlips = prompts.filter((p) => p.verdict === "STRUCTURE-FLIP").length;
  const added = prompts.filter((p) => p.verdict === "NEW").length;
  const removed = prompts.filter((p) => p.verdict === "REMOVED").length;
  const changedPercent = prompts.length === 0 ? 0 : (changed / prompts.length) * 100;

  return {
    prompts,
    summary: {
      total: prompts.length,
      matched,
      identical,
      changed,
      refusalFlips,
      lengthDrifts,
      structureFlips,
      added,
      removed,
      changedPercent,
      medianLengthDelta: median(deltas),
      verdict: changedPercent <= thresholdPercent ? "STABLE" : "DRIFT DETECTED",
    },
  };
}
