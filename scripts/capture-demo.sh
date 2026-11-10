#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# Runs in a scratch dir so nothing pollutes the repo. The transcript is
# rendered to demo/modeldrift-demo.gif by scripts/make-gif.py.
#
# The demo diffs two REAL recorded runs (examples/real/, Gemini API,
# temperature 0, fixed seed 20261110) - not the synthetic seeded fixtures.
# Override BASELINE/CURRENT/MODEL via env to demo other runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=/tmp/modeldrift-demo/work
BIN=/tmp/modeldrift-demo/bin
rm -rf /tmp/modeldrift-demo
mkdir -p "$WORK" "$BIN"
ln -s "$ROOT/dist/cli.js" "$BIN/modeldrift"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

BASELINE="${BASELINE:-$ROOT/examples/real/gemini-3.5-flash-20261110.jsonl}"
CURRENT="${CURRENT:-$ROOT/examples/real/gemini-3.5-flash-lite-20261110.jsonl}"
MODEL="${MODEL:-gemini-3.5-flash}"

cp "$BASELINE" "$WORK/baseline.jsonl"
cp "$CURRENT" "$WORK/current.jsonl"
cd "$WORK"

OUT="$ROOT/demo/transcript.txt"
{
  echo "# modeldrift demo - real CLI output on REAL recorded runs"
  echo "# (Gemini API, temperature 0, seed 20261110, recorded 2026-11-10;"
  echo "#  see examples/real/README.md for provenance.)"
  echo ""
  echo "\$ modeldrift init demo-suite"
  modeldrift init demo-suite
  echo "exit: 0"
  echo ""
  echo "\$ modeldrift pin --model $MODEL --run baseline.jsonl"
  modeldrift pin --model "$MODEL" --run baseline.jsonl
  echo "exit: 0"
  echo ""
  echo "\$ modeldrift diff baseline.jsonl current.jsonl"
  modeldrift diff baseline.jsonl current.jsonl || echo "exit: 1"
  echo ""
  echo "\$ modeldrift check --pin modeldrift.pin.json --run current.jsonl --baseline baseline.jsonl"
  modeldrift check --pin modeldrift.pin.json --run current.jsonl --baseline baseline.jsonl 2>&1 || echo "exit: 1"
} > "$OUT" 2>&1
echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
