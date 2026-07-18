#!/usr/bin/env bash
set -euo pipefail

# Echidna campaign wrapper with preset levels.
# Usage: ./script/fizz_echidna.sh [smoke|standard|deep]

LEVEL="${1:-smoke}"

case "$LEVEL" in
  smoke)
    TEST_LIMIT=50000
    SEQ_LEN=100
    ;;
  standard)
    TEST_LIMIT=500000
    SEQ_LEN=100
    ;;
  deep)
    TEST_LIMIT=1000000
    SEQ_LEN=200
    ;;
  *)
    echo "Usage: $0 [smoke|standard|deep]"
    echo "  smoke    50k calls, seqLen 100  (~1-2 min)"
    echo "  standard 500k calls, seqLen 100 (~10-15 min)"
    echo "  deep     1M calls, seqLen 200   (~30+ min)"
    exit 1
    ;;
esac

echo "Running echidna: level=$LEVEL testLimit=$TEST_LIMIT seqLen=$SEQ_LEN"
exec echidna . --contract FuzzTester --config echidna.yaml \
  --test-limit "$TEST_LIMIT" --seq-len "$SEQ_LEN"
