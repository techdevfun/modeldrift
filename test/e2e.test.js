/**
 * End-to-end tests: the real CLI against the real example fixtures.
 * Covers all four commands plus exit codes (0 / 1 / 2).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CLI = join(ROOT, "dist", "cli.js");
const BASELINE = join(ROOT, "examples", "fable-5.1-baseline.jsonl");
const CURRENT = join(ROOT, "examples", "fable-5.2-current.jsonl");

function run(args, cwd = ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

test("e2e: diff detects drift in the example fixtures (exit 1)", () => {
  const r = run(["diff", BASELINE, CURRENT]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DRIFT DETECTED/);
  assert.match(r.stdout, /REFUSAL-FLIP/);
  assert.match(r.stdout, /refusal flips: 2/);
  assert.match(r.stdout, /length drifts: 1/);
  assert.match(r.stdout, /6 changed \(50\.0%\)/);
});

test("e2e: diff --format json is machine-readable", () => {
  const r = run(["diff", BASELINE, CURRENT, "--format", "json"]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.summary.verdict, "DRIFT DETECTED");
  assert.equal(parsed.prompts.length, 12);
  assert.equal(parsed.prompts.filter((p) => p.verdict === "REFUSAL-FLIP").length, 2);
  assert.equal(parsed.baselineModel, "claude-fable-5.1");
  assert.equal(parsed.currentModel, "claude-fable-5.2");
});

test("e2e: diff of a run against itself is STABLE (exit 0)", () => {
  const r = run(["diff", BASELINE, BASELINE]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /verdict: STABLE/);
  assert.match(r.stdout, /12 identical \(100\.0%\)/);
});

test("e2e: diff --threshold keeps a small change STABLE", () => {
  const r = run(["diff", BASELINE, CURRENT, "--threshold", "50"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /verdict: STABLE/);
});

test("e2e: diff fails cleanly on a missing file (exit 2)", () => {
  const r = run(["diff", BASELINE, "no-such-file.jsonl"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read file/);
});

test("e2e: diff fails cleanly on broken JSON (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const bad = join(dir, "bad.jsonl");
  writeFileSync(bad, '{"id":"a","prompt":"p","output":"o"}\n{broken\n', "utf8");
  const r = run(["diff", BASELINE, bad]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test("e2e: diff refuses prompt sets that differ too much (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const other = join(dir, "other.jsonl");
  const lines = Array.from({ length: 12 }, (_, i) =>
    JSON.stringify({ id: `q-${i}`, prompt: `Question ${i}?`, model: "m", output: "answer", temperature: 0 }),
  ).join("\n") + "\n";
  writeFileSync(other, lines, "utf8");
  const r = run(["diff", BASELINE, other]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /prompt sets differ too much/);
});

test("e2e: init scaffolds a 12-prompt suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const suite = join(dir, "suite");
  const r = run(["init", suite]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /modeldrift init: created/);
  const prompts = JSON.parse(readFileSync(join(suite, "prompts.json"), "utf8"));
  assert.equal(prompts.length, 12);
  const kinds = prompts.map((p) => p.kind);
  for (const kind of ["refusal", "format", "reasoning", "coding"]) {
    assert.equal(kinds.filter((k) => k === kind).length, 3, `expected 3 ${kind} prompts`);
  }
  assert.ok(existsSync(join(suite, "modeldrift.pin.json")));
  assert.ok(existsSync(join(suite, "README.md")));
  // Second init without --force refuses to overwrite.
  const r2 = run(["init", suite]);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /already exists/);
});

test("e2e: pin then check - matching run passes, changed model fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const pinPath = join(dir, "pin.json");
  const pin = run(["pin", "--model", "claude-fable-5.1", "--run", BASELINE, "--out", pinPath]);
  assert.equal(pin.status, 0);
  assert.match(pin.stdout, /model: claude-fable-5\.1/);
  const pinned = JSON.parse(readFileSync(pinPath, "utf8"));
  assert.match(pinned.promptSetSha256, /^[0-9a-f]{64}$/);
  assert.match(pinned.baselineRunSha256, /^[0-9a-f]{64}$/);

  const ok = run(["check", "--pin", pinPath, "--run", BASELINE, "--baseline", BASELINE]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /pin OK/);
  assert.match(ok.stdout, /verdict: STABLE/);

  const bad = run(["check", "--pin", pinPath, "--run", CURRENT, "--baseline", BASELINE]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /model changed silently - expected claude-fable-5\.1, got claude-fable-5\.2/);
});

test("e2e: check without --baseline verifies the pin only", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const pinPath = join(dir, "pin.json");
  assert.equal(run(["pin", "--model", "claude-fable-5.1", "--run", BASELINE, "--out", pinPath]).status, 0);
  const r = run(["check", "--pin", pinPath, "--run", BASELINE]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pin verified, no diff run/);
});

test("e2e: check rejects a run recorded against different prompts (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "modeldrift-e2e-"));
  const pinPath = join(dir, "pin.json");
  assert.equal(run(["pin", "--model", "claude-fable-5.1", "--run", BASELINE, "--out", pinPath]).status, 0);
  const other = join(dir, "other.jsonl");
  const lines = Array.from({ length: 12 }, (_, i) =>
    JSON.stringify({ id: `q-${i}`, prompt: `Question ${i}?`, model: "claude-fable-5.1", output: "answer", temperature: 0 }),
  ).join("\n") + "\n";
  writeFileSync(other, lines, "utf8");
  const r = run(["check", "--pin", pinPath, "--run", other]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /prompt set does not match the pin/);
});

test("e2e: --help and --version", () => {
  assert.equal(run(["--help"]).status, 0);
  assert.match(run(["--help"]).stdout, /modeldrift diff/);
  assert.match(run(["--version"]).stdout, /modeldrift 0\.1\.0/);
  assert.equal(run(["nonsense"]).status, 2);
});
