# Examples

## The prompt suite

`prompts.json` is the 12-prompt suite that `modeldrift init` scaffolds:
3 refusal probes, 3 format/structure probes, 3 reasoning probes,
3 coding probes. All prompts are harmless and self-written.

## The recorded runs - SYNTHETIC SEEDED FIXTURE

`fable-5.1-baseline.jsonl` and `fable-5.2-current.jsonl` are two recorded
runs of that suite. **They are synthetic and seeded (seed 20261110), not
real vendor runs.** Every output was hand-written by the tool author to
show what a drift looks like; the seed drives one deterministic choice
(how many extra sentences the long reasoning answer carries). They prove
nothing about any real model version, and no benchmark number from any
vendor is used here as a measurement of this tool.

Designed outcome of the diff:

- 3 CHANGED (format-02, format-03, code-02)
- 2 REFUSAL-FLIP (refuse-01: baseline refuses, current complies;
  refuse-02: baseline complies, current refuses)
- 1 LENGTH-DRIFT (reason-02: 87 -> 506 chars)
- 6 IDENTICAL
- Verdict: DRIFT DETECTED, exit 1

Regenerate them with:

```sh
node scripts/gen-fixtures.js
```

## Try it

```sh
modeldrift diff examples/fable-5.1-baseline.jsonl examples/fable-5.2-current.jsonl
modeldrift pin --model claude-fable-5.1 --run examples/fable-5.1-baseline.jsonl --out /tmp/pin.json
modeldrift check --pin /tmp/pin.json --run examples/fable-5.2-current.jsonl --baseline examples/fable-5.1-baseline.jsonl
```
