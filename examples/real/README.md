# Real recorded runs

These are REAL runs, recorded live on 2026-11-10 against the Gemini API -
not the synthetic seeded fixtures in `examples/`. Same 12 prompts as
`examples/prompts.json`, temperature 0, seed 20261110, one API call per
prompt. Each record carries its provenance: `model`, `modelVersion`
(the version the API actually served), `temperature`, `seed`,
`provider`, `recordedAt`.

## The runs

| File | Model requested | Served version | Provider | Recorded |
| --- | --- | --- | --- | --- |
| `gemini-3.5-flash-20261110.jsonl` | gemini-3.5-flash | gemini-3.6-flash | google-ai-studio | 2026-11-10 12:24 UTC |
| `gemini-3.5-flash-lite-20261110.jsonl` | gemini-3.5-flash-lite | gemini-3.5-flash-lite | google-ai-studio | 2026-11-10 12:25 UTC |
| `gemini-3.5-flash-20261110-repeat-stali.jsonl` | gemini-3.5-flash | gemini-3.5-flash | stali | 2026-11-10 12:43 UTC |

Each file has a `.meta.json` sidecar with token counts and the exact
recording parameters (including `thinkingBudget`: 0 for the baseline
run, -1 for the lite run - the lite model rejects `thinkingBudget: 0`
with a 400, so thinking was left unset there; the Stali run records
no such field).

Token counts are as reported by each gateway: 253 prompt / 5,403
candidate tokens (baseline), 253 / 4,801 (lite), 24,265 / 4,822
(repeat via Stali - Stali reports far higher prompt tokens, presumably
gateway overhead; the number is quoted as returned, not adjusted).

## Cross-version diff (the point of the tool)

```sh
modeldrift diff gemini-3.5-flash-20261110.jsonl gemini-3.5-flash-lite-20261110.jsonl
# 12 prompts: 1 identical (8.3%), 11 changed (91.7%)
# refusal flips: 1, length drifts: 1, structure flips: 0, new: 0, removed: 0
# verdict: DRIFT DETECTED (exit 1)
```

Only `format-01` (first five primes as JSON) came back byte-identical.
Everything else moved: code answers got shorter, reasoning answers got
reworded, lock-picking explanations changed length by thousands of
characters.

## Same-model control (the noise band) - READ THIS FIRST

```sh
modeldrift diff gemini-3.5-flash-20261110.jsonl gemini-3.5-flash-20261110-repeat-stali.jsonl
# 12 prompts: 1 identical (8.3%), 11 changed (91.7%)
# refusal flips: 0, length drifts: 2, structure flips: 0, new: 0, removed: 0
# verdict: DRIFT DETECTED (exit 1)
```

The same model recorded a second time, at temperature 0 with the same
seed, ALSO diffs at 11 of 12 changed. The seed does not make this model
deterministic, and long free-form answers reword on every recording.
Two caveats, stated plainly:

1. The repeat went through a different gateway (Stali, not Google AI
   Studio directly), and the served versions differ: the baseline was
   served as `gemini-3.6-flash`, the repeat as `gemini-3.5-flash`.
   So this control measures same-model-id repeatability *across
   gateways*, not a pure same-endpoint repeat. A clean same-gateway
   repeat was started (5 of 12 prompts recorded) but the Google AI
   Studio key then hit its free-tier daily limit - 20
   `generate_content` requests/day for gemini-3.6-flash - and the
   remaining prompts could not be recorded the same day.
2. Because the control also reads 11/12 changed, the cross-version
   11/12 above cannot by itself be read as "the lite version changed
   behavior". The honest reading: at temperature 0, this prompt set
   cannot separate version drift from sampling noise. That is exactly
   what the tool is for - it reports that outputs differ, and the
   control tells you how much of that is noise.

## One false-positive refusal flip, found by the real data

The cross-version diff reports 1 REFUSAL-FLIP on `refuse-01`. It is a
false positive: the lite model complied with a story in which a
character says "I can't access that much from the drawer", and the
detector matched the dialogue, not a refusal. A flip is a signal to
read the diff, not a verdict about the model - this run proves why.

## ASCII folding (why the outputs are not byte-identical to the API)

Real model outputs contain non-ASCII characters (curly quotes, em
dashes, accented letters, one emoji). The repo requires 100% ASCII
public text, so outputs were folded with a fixed mechanical mapping,
applied identically to every run file: curly quotes to straight
quotes, em/en dashes to `--`/`-`, ellipsis to `...`, accented letters
to their base letter, emoji dropped. The mapping never touches
structure, and because it runs identically on both sides of every
diff, verdicts still measure real behavioral differences. Raw outputs
were not kept: the folded files ARE the recorded runs as shipped, and
this note is the provenance.

## Try it

```sh
modeldrift diff examples/real/gemini-3.5-flash-20261110.jsonl examples/real/gemini-3.5-flash-lite-20261110.jsonl
modeldrift diff examples/real/gemini-3.5-flash-20261110.jsonl examples/real/gemini-3.5-flash-20261110-repeat-stali.jsonl
```
