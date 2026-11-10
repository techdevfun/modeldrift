/**
 * Unit tests for the diff engine, refusal detector, pin hashing, and
 * length/structure signals. Pure functions over the compiled dist output.
 * No network, no provider calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { diffRuns, lengthRatio, parsesAsJson, wantsJson } from "../dist/diff.js";
import { isRefusal, REFUSAL_PHRASES } from "../dist/refusal.js";
import { parseRun, normalizeOutput, loadRun } from "../dist/runfile.js";
import { promptSetSha256, createPin, parsePin, sha256Hex } from "../dist/pin.js";

const rec = (id, output, prompt = "Say hello.") => ({ id, prompt, output });

test("diff: identical after whitespace normalization", () => {
  const r = diffRuns([rec("a", "hello   world\n")], [rec("a", "hello world")]);
  assert.equal(r.prompts[0].verdict, "IDENTICAL");
  assert.equal(r.summary.verdict, "STABLE");
  assert.equal(r.summary.changedPercent, 0);
});

test("diff: changed output, exit-relevant verdict DRIFT DETECTED", () => {
  const r = diffRuns([rec("a", "hello")], [rec("a", "goodbye")]);
  assert.equal(r.prompts[0].verdict, "CHANGED");
  assert.equal(r.summary.verdict, "DRIFT DETECTED");
  assert.equal(r.summary.changedPercent, 100);
});

test("diff: threshold lets small change stay STABLE", () => {
  const base = [rec("a", "one"), rec("b", "two"), rec("c", "three"), rec("d", "four")];
  const cur = [rec("a", "ONE"), rec("b", "two"), rec("c", "three"), rec("d", "four")];
  assert.equal(diffRuns(base, cur).summary.verdict, "DRIFT DETECTED");
  assert.equal(diffRuns(base, cur, { thresholdPercent: 25 }).summary.verdict, "STABLE");
});

test("diff: NEW and REMOVED prompts", () => {
  const r = diffRuns([rec("a", "x"), rec("gone", "y")], [rec("a", "x"), rec("new", "z")]);
  assert.equal(r.prompts.find((p) => p.id === "new").verdict, "NEW");
  assert.equal(r.prompts.find((p) => p.id === "gone").verdict, "REMOVED");
  assert.equal(r.summary.added, 1);
  assert.equal(r.summary.removed, 1);
});

test("refusal: detects both directions of a flip", () => {
  assert.equal(isRefusal("I can't help with that."), true);
  assert.equal(isRefusal("I'm sorry, but I can't write that."), true);
  assert.equal(isRefusal("I am unable to comply with this request."), true);
  assert.equal(isRefusal("Here is the story you asked for."), false);
  assert.equal(isRefusal("The capital of France is Paris."), false);
  const r = diffRuns(
    [rec("a", "I can't help with that.")],
    [rec("a", "Here is the story you asked for.")],
  );
  assert.equal(r.prompts[0].verdict, "REFUSAL-FLIP");
  assert.equal(r.summary.refusalFlips, 1);
  const r2 = diffRuns(
    [rec("a", "Here is the story you asked for.")],
    [rec("a", "I cannot help with that request.")],
  );
  assert.equal(r2.prompts[0].verdict, "REFUSAL-FLIP");
});

test("refusal: known false positives stay non-refusal", () => {
  // The idiom "I can't believe ..." is enthusiasm, not a refusal.
  assert.equal(isRefusal("I can't believe how good this is"), false);
  assert.equal(isRefusal("I cannot believe this worked on the first try."), false);
  // A refusal phrase quoted mid-sentence is not a refusal opening.
  assert.equal(isRefusal('He said "I can\'t do it" and walked away.'), false);
  assert.equal(isRefusal("The user wrote that I can't be trusted with this."), false);
});

test("refusal: a refusal that opens a later sentence still counts", () => {
  assert.equal(isRefusal("Here is my draft. I can't finish this request."), true);
  assert.equal(isRefusal("Sure, here is the story.\nI am unable to continue."), true);
});

test("refusal: phrase list is public and non-empty", () => {
  assert.ok(REFUSAL_PHRASES.length >= 10);
  assert.ok(REFUSAL_PHRASES.includes("i can't"));
  assert.ok(REFUSAL_PHRASES.includes("i'm unable to"));
});

test("length: ratio math and LENGTH-DRIFT threshold", () => {
  assert.equal(lengthRatio(100, 100), 0);
  assert.equal(lengthRatio(100, 150), 0.5);
  assert.equal(lengthRatio(0, 10), 10);
  const short = "x".repeat(100);
  const long = "y".repeat(200);
  const r = diffRuns([rec("a", short)], [rec("a", long)]);
  assert.equal(r.prompts[0].verdict, "LENGTH-DRIFT");
  assert.equal(r.summary.lengthDrifts, 1);
  const r2 = diffRuns([rec("a", short)], [rec("a", long)], { lengthThreshold: 1.5 });
  assert.equal(r2.prompts[0].verdict, "CHANGED");
});

test("structure: JSON validity flip on a JSON prompt", () => {
  assert.equal(parsesAsJson('{"a": 1}'), true);
  assert.equal(parsesAsJson("not json"), false);
  assert.equal(wantsJson("Reply with JSON only."), true);
  assert.equal(wantsJson("Name three colors."), false);
  const r = diffRuns(
    [rec("a", '{"primes": [2, 3]}', "Reply with JSON only.")],
    [rec("a", "The primes are 2 and 3.", "Reply with JSON only.")],
  );
  assert.equal(r.prompts[0].verdict, "STRUCTURE-FLIP");
  assert.equal(r.summary.structureFlips, 1);
});

test("structure: no flip when the prompt does not ask for JSON", () => {
  // JSON validity flips, but the prompt never asked for JSON: the verdict
  // is CHANGED, not STRUCTURE-FLIP.
  const r = diffRuns(
    [rec("a", "not json at al", "Say hello.")],
    [rec("a", '{"a": 123456}', "Say hello.")],
  );
  assert.equal(r.prompts[0].verdict, "CHANGED");
  assert.equal(r.summary.structureFlips, 0);
});

test("structure: code output starting with '{' is not a JSON flip", () => {
  // A code answer that starts with an object literal is not JSON output:
  // the prompt asks for code, not JSON, so a JSON-validity change is
  // just CHANGED.
  const prompt = "Write a JavaScript function that returns an object literal.";
  const r = diffRuns(
    [rec("a", 'const o = {"a": 1};', prompt)],
    [rec("a", '{"a": 1}      ', prompt)],
  );
  assert.equal(r.prompts[0].verdict, "CHANGED");
  assert.equal(r.summary.structureFlips, 0);
});

test("verdict priority: refusal flip beats length drift", () => {
  const r = diffRuns(
    [rec("a", "A short answer.")],
    [rec("a", "I can't help with that. " + "x".repeat(500))],
  );
  assert.equal(r.prompts[0].verdict, "REFUSAL-FLIP");
});

test("pin: prompt-set hash is stable under reordering, sensitive to text", () => {
  const a = [rec("a", "one", "Prompt A"), rec("b", "two", "Prompt B")];
  const reordered = [rec("b", "two", "Prompt B"), rec("a", "one", "Prompt A")];
  const changed = [rec("a", "one", "Prompt A CHANGED"), rec("b", "two", "Prompt B")];
  assert.equal(promptSetSha256(a), promptSetSha256(reordered));
  assert.notEqual(promptSetSha256(a), promptSetSha256(changed));
  assert.match(promptSetSha256(a), /^[0-9a-f]{64}$/);
});

test("pin: create + parse round-trip", () => {
  const records = [rec("a", "one", "Prompt A")];
  const pin = createPin("model-x-1.0", records, '{"id":"a"}');
  assert.equal(pin.model, "model-x-1.0");
  assert.equal(pin.promptSetSha256, promptSetSha256(records));
  assert.equal(pin.baselineRunSha256, sha256Hex('{"id":"a"}'));
  assert.equal(parsePin(JSON.stringify(pin), "pin.json").model, "model-x-1.0");
  assert.throws(() => parsePin('{"model": 1}', "pin.json"), /missing a string/);
  assert.throws(() => parsePin("not json", "pin.json"), /not valid JSON/);
});

test("runfile: parse errors are explicit", () => {
  assert.throws(() => parseRun('{"id":"a"}', "run.jsonl"), /missing a string "prompt"/);
  assert.throws(() => parseRun("{bad json", "run.jsonl"), /not valid JSON/);
  assert.throws(() => parseRun('{"id":"a","prompt":"p","output":"o"}\n{"id":"a","prompt":"p","output":"o"}', "run.jsonl"), /duplicate prompt id/);
  assert.throws(() => parseRun("", "run.jsonl"), /no records found/);
  assert.equal(normalizeOutput("  a\n\n b  "), "a b");
});

test("runfile: model resolution rules", () => {
  const text = '{"id":"a","prompt":"p","output":"o","model":"m1"}\n{"id":"b","prompt":"p","output":"o","model":"m1"}';
  assert.equal(loadRun(text, "r.jsonl").model, "m1");
  assert.throws(
    () => loadRun('{"id":"a","prompt":"p","output":"o"}', "r.jsonl"),
    /no "model"/,
  );
  assert.equal(loadRun('{"id":"a","prompt":"p","output":"o"}', "r.jsonl", "m9").model, "m9");
  const mixed =
    '{"id":"a","prompt":"p","output":"o","model":"m1"}\n{"id":"b","prompt":"p","output":"o","model":"m2"}';
  assert.throws(() => loadRun(mixed, "r.jsonl"), /disagree on "model"/);
  const warm = '{"id":"a","prompt":"p","output":"o","model":"m1","temperature":0.7}';
  assert.equal(loadRun(warm, "r.jsonl").hasNonZeroTemperature, true);
});

test("summary: median length delta", () => {
  const base = [rec("a", "x".repeat(10)), rec("b", "y".repeat(20)), rec("c", "z".repeat(30))];
  const cur = [rec("a", "x".repeat(12)), rec("b", "y".repeat(20)), rec("c", "z".repeat(36))];
  const r = diffRuns(base, cur);
  assert.equal(r.summary.medianLengthDelta, 2);
});
