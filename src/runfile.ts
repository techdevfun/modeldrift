/**
 * Canonical recorded-run format (JSONL, one record per line).
 *
 *   {"id":"refuse-01","prompt":"...","model":"claude-fable-5.1","output":"...","temperature":0}
 *
 * Required fields: id, prompt, output. `model` is required at run level:
 * either on every record or via --model when the command accepts it.
 * `temperature` is optional but recommended (0). modeldrift never calls a
 * provider: every run file is data the user recorded themselves.
 */

export interface RunRecord {
  id: string;
  prompt: string;
  output: string;
  model?: string;
  temperature?: number;
}

export interface RunFile {
  records: RunRecord[];
  /** Model id for the whole run, when every record agrees (or --model was given). */
  model?: string;
  /** True when any record reports a temperature other than 0. */
  hasNonZeroTemperature: boolean;
}

export class RunError extends Error {}

/** Parse one JSONL text into records. Throws RunError with a clear message. */
export function parseRun(text: string, sourceName: string): RunRecord[] {
  const records: RunRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new RunError(
        `${sourceName}: line ${i + 1} is not valid JSON: ${line.slice(0, 80)}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new RunError(`${sourceName}: line ${i + 1} is not a JSON object.`);
    }
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id === "") {
      throw new RunError(`${sourceName}: line ${i + 1} is missing a string "id".`);
    }
    if (typeof rec.prompt !== "string") {
      throw new RunError(`${sourceName}: line ${i + 1} (id "${rec.id}") is missing a string "prompt".`);
    }
    if (typeof rec.output !== "string") {
      throw new RunError(`${sourceName}: line ${i + 1} (id "${rec.id}") is missing a string "output".`);
    }
    if (rec.model !== undefined && typeof rec.model !== "string") {
      throw new RunError(`${sourceName}: line ${i + 1} (id "${rec.id}") has a non-string "model".`);
    }
    if (rec.temperature !== undefined && typeof rec.temperature !== "number") {
      throw new RunError(`${sourceName}: line ${i + 1} (id "${rec.id}") has a non-numeric "temperature".`);
    }
    records.push({
      id: rec.id,
      prompt: rec.prompt,
      output: rec.output,
      model: rec.model as string | undefined,
      temperature: rec.temperature as number | undefined,
    });
  }
  if (records.length === 0) {
    throw new RunError(`${sourceName}: no records found (empty run file).`);
  }
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) {
      throw new RunError(`${sourceName}: duplicate prompt id "${r.id}".`);
    }
    seen.add(r.id);
  }
  return records;
}

/** Load a run file, resolve its model, and flag non-zero temperature. */
export function loadRun(text: string, sourceName: string, modelOverride?: string): RunFile {
  const records = parseRun(text, sourceName);
  const models = new Set(records.map((r) => r.model).filter((m): m is string => m !== undefined));
  let model: string | undefined;
  if (modelOverride !== undefined) {
    model = modelOverride;
  } else if (models.size === 1) {
    model = [...models][0];
  } else if (models.size === 0) {
    throw new RunError(
      `${sourceName}: no "model" on any record; pass --model <id> to name the model for this run.`,
    );
  } else {
    throw new RunError(
      `${sourceName}: records disagree on "model" (${[...models].join(", ")}); pass --model <id> to name one model for the run.`,
    );
  }
  const hasNonZeroTemperature = records.some(
    (r) => r.temperature !== undefined && r.temperature !== 0,
  );
  return { records, model, hasNonZeroTemperature };
}

/** Normalize output for comparison: trim + collapse all whitespace runs. */
export function normalizeOutput(output: string): string {
  return output.trim().replace(/\s+/g, " ");
}

/** sha256 hex of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}
