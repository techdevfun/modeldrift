#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# Runs in a scratch dir so nothing pollutes the repo. The transcript is
# rendered to demo/modeldrift-demo.gif by scripts/make-gif.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=/tmp/modeldrift-demo/work
BIN=/tmp/modeldrift-demo/bin
rm -rf /tmp/modeldrift-demo
mkdir -p "$WORK" "$BIN"
ln -s "$ROOT/dist/cli.js" "$BIN/modeldrift"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

cp "$ROOT/examples/fable-5.1-baseline.jsonl" "$WORK/"
cp "$ROOT/examples/fable-5.2-current.jsonl" "$WORK/"
cd "$WORK"

OUT="$ROOT/demo/transcript.txt"
{
  echo "# modeldrift demo - real CLI output. Fixtures: SYNTHETIC SEEDED runs"
  echo "# (seed 20261110, hand-written outputs), NOT real vendor runs."
  echo ""
  echo "\$ modeldrift init demo-suite"
  modeldrift init demo-suite
  echo "exit: 0"
  echo ""
  echo "\$ modeldrift pin --model claude-fable-5.1 --run fable-5.1-baseline.jsonl"
  modeldrift pin --model claude-fable-5.1 --run fable-5.1-baseline.jsonl
  echo "exit: 0"
  echo ""
  echo "\$ modeldrift diff fable-5.1-baseline.jsonl fable-5.2-current.jsonl"
  modeldrift diff fable-5.1-baseline.jsonl fable-5.2-current.jsonl || echo "exit: 1"
  echo ""
  echo "\$ modeldrift check --pin modeldrift.pin.json --run fable-5.2-current.jsonl --baseline fable-5.1-baseline.jsonl"
  modeldrift check --pin modeldrift.pin.json --run fable-5.2-current.jsonl --baseline fable-5.1-baseline.jsonl 2>&1 || echo "exit: 1"
} > "$OUT" 2>&1
echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
