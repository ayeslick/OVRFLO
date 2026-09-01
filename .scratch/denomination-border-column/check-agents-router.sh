#!/bin/sh
# Fail if the denomination plan still assigns AGENTS.md architecture copy,
# or if sweep rule 12 and spec authority 1-12 are missing.
set -e
root=$(git rev-parse --show-toplevel)
plan="$root/docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md"
spec="$root/.scratch/denomination-border-column/spec.md"
hits=$(grep -nE 'AGENTS\.md overview|overview and solvency fact' "$plan" || true)
if [ -n "$hits" ]; then
  printf '%s\n' "$hits" >&2
  echo 'FAIL: plan still assigns AGENTS.md architecture copy' >&2
  exit 1
fi
grep -q 'AGENTS.md is the session router (U8)' "$plan" || {
  echo 'FAIL: sweep rule 12 missing' >&2
  exit 1
}
grep -q 'inherited CS1 rules 1–12' "$spec" || {
  echo 'FAIL: spec authority still not 1-12' >&2
  exit 1
}
echo OK
