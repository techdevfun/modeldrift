# modeldrift

Pin the model version, diff two recorded runs of the same prompts, and get a CI verdict - STABLE or DRIFT DETECTED - without calling any provider, without an API key, without a server.

Model vendors change behavior silently: a new version ships, a prompt that used to comply now refuses, an answer that used to be one paragraph is now five. modeldrift catches that drift by comparing runs you already recorded, with deterministic signals only. It never runs an eval, never calls a model, never judges quality - it reports that outputs differ, where, and how.

## Install (from source)

The npm package is not published yet. Install from source:

```sh
git clone https://github.com/techdevfun/modeldrift.git
cd modeldrift
npm install
npm run build
```

Then run it with `node dist/cli.js`, or link the binary once:

```sh
npm link   # makes `modeldrift` available on your PATH
```

Requires Node.js 20 or newer. Zero runtime dependencies.

## Quick start

```sh
# 1. Scaffold a prompt suite (12 prompts: refusal, format, reasoning, coding)
modeldrift init demo-suite

# 2. Record a baseline run of those prompts against your model (temperature 0,
#    fixed seed) as JSONL - one record per line:
#    {"id":"refuse-01","prompt":"...","model":"claude-fable-5.1","output":"...","temperature":0}

# 3. Pin the model + prompt set + baseline run
modeldrift pin --model claude-fable-5.1 --run baseline.jsonl

# 4. After a new model version ships, record the same prompts again and diff
modeldrift diff baseline.jsonl current.jsonl
# exit 0 = STABLE, 1 = DRIFT DETECTED, 2 = input error

# 5. Or verify the pin and diff in one step
modeldrift check --pin modeldrift.pin.json --run current.jsonl --baseline baseline.jsonl
# FAIL fast when the run's model does not match the pin:
# "model changed silently - expected claude-fable-5.1, got claude-fable-5.2"
```

## Commands

| Command | What it does |
| --- | --- |
| `modeldrift init [dir]` | Scaffold `prompts.json` (12 sample prompts), a pin template, and a short README. Refuses to overwrite unless `--force` is given. |
| `modeldrift diff <baseline.jsonl> <current.jsonl>` | Compare two recorded runs. `--format table\|json` (default `table`), `--threshold N` (changed-% that still counts as STABLE, default 0), `--length-threshold N` (length-ratio that counts as LENGTH-DRIFT, default 0.5). |
| `modeldrift pin --model <id> --run <file> [--out <file>]` | Write a pin: model id, sha256 of the prompt set, sha256 of the baseline run, creation time. |
| `modeldrift check --pin <pin> --run <file> [--baseline <file>]` | Verify the run's model and prompt set against the pin, then diff against the baseline when `--baseline` is given. |

## What a diff reports

Per prompt, one verdict:

| Verdict | Meaning |
| --- | --- |
| `IDENTICAL` | Output identical after whitespace normalization. |
| `CHANGED` | Output differs. |
| `REFUSAL-FLIP` | One side refuses, the other complies (see the phrase list below). |
| `LENGTH-DRIFT` | Length ratio exceeds the threshold (default 50%). |
| `STRUCTURE-FLIP` | JSON validity flips on a prompt that asks for JSON. |
| `NEW` / `REMOVED` | Prompt present on one side only. |

Summary: identical/changed %, refusal flips, median length delta, and the overall verdict `STABLE` or `DRIFT DETECTED`. When NEW + REMOVED prompts exceed 25% of the union, diff refuses with exit 2: the two runs are not the same prompt set.

Note: the summary's `changed` counts every prompt that is not `IDENTICAL` - that includes the `CHANGED` verdicts as well as every `REFUSAL-FLIP`, `LENGTH-DRIFT`, `STRUCTURE-FLIP`, `NEW`, and `REMOVED` prompt. A per-prompt verdict of `CHANGED` is narrower: the output differs, but no flip or drift signal fired.

Runs are JSONL, one record per line. Required fields: `id`, `prompt`, `output`. `model` is required at run level (on every record, or via `--model`). `temperature` is optional but recommended to be 0 - when a run records a temperature other than 0, diff prints a warning that changed % may include sampling noise.

## Refusal detection (heuristic, public list)

A refusal is detected by matching any of these phrases (case-insensitive):

> "I can't", "I cannot", "I'm unable to", "I am unable to", "I apologize, but I can't", "I apologize, but I cannot", "I'm sorry, but I can't", "I am sorry, but I cannot", "I'm sorry, but I am unable to", "I can't help with that", "I cannot help with that", "I'm not able to", "I am not able to", "I won't be able to", "I must decline", "I have to decline", "Sorry, I can't", "Sorry, I cannot", "I can't comply", "I cannot comply"

This is a heuristic, not ground truth. A phrase only counts when it opens the output or opens a sentence inside it - a passing mention mid-sentence ("He said he can't do it") does not count, and neither does the idiom "I can't believe ..." ("I can't believe how good this is" is enthusiasm, not a refusal). It can still false-negative (a polite sidestep that never says "can't"). modeldrift reports REFUSAL-FLIP as "one side refuses, the other does not, by this phrase list" - you decide what the flip means.

## Examples

`examples/` ships a 12-prompt suite (`prompts.json`) and two recorded runs:

- `fable-5.1-baseline.jsonl` - baseline run, model `claude-fable-5.1`
- `fable-5.2-current.jsonl` - current run, model `claude-fable-5.2`

```sh
modeldrift diff examples/fable-5.1-baseline.jsonl examples/fable-5.2-current.jsonl
# 12 prompts: 6 identical (50.0%), 6 changed (50.0%)
# refusal flips: 2, length drifts: 1, structure flips: 0, new: 0, removed: 0
# verdict: DRIFT DETECTED (exit 1)
```

**These fixtures are synthetic and seeded (seed 20261110), not real vendor runs.** The outputs are hand-written to show what a drift looks like. They prove nothing about any real model version. See `examples/README.md` for provenance.

## Real recorded runs

`examples/real/` ships two runs recorded live against the Gemini API on 2026-11-10 (temperature 0, seed 20261110, thinking disabled for the full model) - the same 12 prompts, two model versions:

- `gemini-3.5-flash-20261110.jsonl` - baseline, model `gemini-3.5-flash` (API served version `gemini-3.6-flash`)
- `gemini-3.5-flash-lite-20261110.jsonl` - current, model `gemini-3.5-flash-lite`

```sh
modeldrift diff examples/real/gemini-3.5-flash-20261110.jsonl examples/real/gemini-3.5-flash-lite-20261110.jsonl
# 12 prompts: 1 identical (8.3%), 11 changed (91.7%)
# refusal flips: 1, length drifts: 1, structure flips: 0, new: 0, removed: 0
# verdict: DRIFT DETECTED (exit 1)
```

The same-model control (`gemini-3.5-flash-20261110-repeat-stali.jsonl`, the same model recorded a second time at temperature 0 with the same seed) diffs against the baseline at 11 changed out of 12 as well - 0 refusal flips, 2 length drifts, DRIFT DETECTED. The seed does not make Gemini deterministic, and long free-form answers reword on every recording. Caveat, stated in `examples/real/README.md`: the repeat went through a different gateway (Stali) and was served as `gemini-3.5-flash` while the baseline was served as `gemini-3.6-flash`, so the control measures same-model repeatability across gateways; a clean same-gateway repeat was blocked by the API key's free-tier daily limit (20 requests/day). Because the control also reads 11/12, the cross-version 11/12 cannot by itself be read as "the lite version changed behavior" - that is the noise band, and the tool reports it honestly instead of hiding it. One more honest caveat: the single REFUSAL-FLIP in the cross-version diff is a false positive (character dialogue inside a story, not a model refusal).

Outputs were ASCII-folded before shipping (curly quotes, em dashes, accented letters, one emoji) so the public repo stays 100% ASCII; the folding is a fixed mechanical mapping, applied identically to every run - see `examples/real/README.md`.

## Where rivals beat us

- **promptfoo** runs evals live across providers, with LLM-as-judge rubrics, red-team drift detection, and a web UI for comparing runs. It also has a standalone `promptfoo diff baseline.json new.json` command that diffs two eval runs without re-running anything. What modeldrift adds on top of that: it diffs any two JSONL run files you already recorded - no eval run through promptfoo first, no YAML config, no API key, no server - in one zero-dependency command with a pin file and a CI exit code. If you already live in promptfoo, use its diff; modeldrift is for teams that record runs elsewhere (or by hand) and want the same gate without adopting the framework.
- **claude-drift** replays real Claude Code sessions on a new model and separates drift from noise with self-replays. modeldrift does not replay anything and does not measure a noise band; if your runs were recorded at temperature above 0, changed % will mix sampling noise into real drift.
- **Langfuse / DeepEval / lm-eval-harness** cover tracing, RAG quality metrics, and standard eval suites. modeldrift is a narrower layer: run-vs-run behavior diff plus a model pin, for teams that already record their evals and want a one-command CI gate on top.

## Honest limits

- **Sampling noise:** at temperature above 0, the same model gives different outputs on repeated runs. Record at temperature 0 with a fixed seed, or expect changed % to include noise. modeldrift warns when a run records temperature other than 0. Measured, not assumed: the same-model control in `examples/real/` (same model, temperature 0, same seed, recorded twice) still diffs at 11 of 12 changed - the seed does not make the model deterministic. Always record a control before calling a cross-version diff "drift".
- **Refusal heuristic:** the phrase list is a rough detector (see above). A flip is a signal to read the diff, not a verdict about the model. Real example from the shipped runs: in the cross-version diff in `examples/real/`, the one REFUSAL-FLIP is a false positive - the lite model complied with a story in which a character says "I can't access that much from the drawer", and the detector matched the dialogue, not a refusal.
- **Same-version silent weight changes:** a pin catches a changed version string. If a vendor changes weights under the same version string, only the output diff can catch it - that is exactly what diff is for, but a small change may stay under your threshold.
- **No quality judgment:** modeldrift reports that outputs differ, never whether the new output is better or worse. "Better or worse" is the reader's job.

## Demo

![modeldrift demo](demo/modeldrift-demo.gif)

The demo runs the real CLI: `init`, `pin` (gemini-3.5-flash), `diff` of the two real recorded runs in `examples/real/` (DRIFT DETECTED, exit 1: 11 of 12 prompts changed), and `check` against a run recorded as gemini-3.5-flash-lite (FAIL: model mismatch). Transcript: `demo/transcript.txt`. GIF: 466 frames, 31.80 s, measured with ffprobe.

## Development

```sh
npm run build    # tsc, strict
npm test         # unit + e2e (node --test, explicit file list)
npm run test:live  # live smoke: name checks, soft-skips offline
npm run preflight  # Rule 7 scan: ASCII-only + no internal names
```

## Roadmap

- `--json` diff output already supported; add `--format csv` for spreadsheets.
- Optional `--baseline` discovery from the pin file itself.
- Publish to npm once a registry token is available (install-from-source until then).
- A `--noise-band` mode: diff two runs of the same model to measure sampling noise before judging drift.

## License

MIT - see [LICENSE](LICENSE).
