#!/usr/bin/env bash
#
# check-banned-patterns.sh — R22
#
# Guards against regressions of patterns that were deliberately removed.
# Any match in web/{lib,hooks,components,app} fails with the offending
# line so CI points reviewers straight at the violation.
#
# The seed list comes from origin docs/solutions entries + the plan's
# "Scope Boundaries" table. Keep it narrow: every pattern here must
# reference a concrete, documented regression we already fixed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if command -v rg >/dev/null 2>&1; then
  SEARCH_CMD="rg"
else
  # rg is preferred (faster + respects .gitignore), but fall back to grep
  # so this script is portable to macOS default installs and minimal CI
  # images that don't have ripgrep.
  SEARCH_CMD="grep"
fi

# Pattern → rationale (one-liner used in the failure message).
PATTERNS=(
  # docs/solutions/developer-experience entries — log-scan fallback is banned.
  'FACTORY_FROM_BLOCK|Log-scan fallback was removed; rely on the indexer path.'
  'useApprovedMarkets|Replaced by useAllMarkets; do not reintroduce an approved-only filter.'
  'parseStreamError|Superseded by classifyUserError / StreamScanError; remove stragglers.'
  'watchContractEvent.*Deposited|Event-scan fallback is banned; use factory reads.'
  'getLogs.*Deposited|Event-scan fallback is banned; use factory reads.'
  'nativeUsd|Renamed/removed; use the price API surface in lib/prices.'
)

SEARCH_ROOTS=(
  "$WEB_ROOT/lib"
  "$WEB_ROOT/hooks"
  "$WEB_ROOT/components"
  "$WEB_ROOT/app"
)

# Only scan directories that actually exist (skip app/ on repos where it
# hasn't been scaffolded yet — ripgrep errors on missing paths).
EXISTING_ROOTS=()
for root in "${SEARCH_ROOTS[@]}"; do
  [[ -d "$root" ]] && EXISTING_ROOTS+=("$root")
done

violations=0
for entry in "${PATTERNS[@]}"; do
  pattern="${entry%%|*}"
  rationale="${entry#*|}"
  if [[ "$SEARCH_CMD" == "rg" ]]; then
    # Exit 1 from rg means "no matches", which is success here.
    if output=$(rg --line-number --with-filename --no-heading --color=never \
      --glob '!*.test.*' --glob '!*.spec.*' \
      "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null); then
      echo "check-banned-patterns: $pattern ($rationale)" >&2
      echo "$output" >&2
      violations=$((violations + 1))
    fi
  else
    # POSIX grep fallback: recursive, extended regex, exclude tests.
    if output=$(grep -rnE \
      --exclude='*.test.*' --exclude='*.spec.*' \
      "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null); then
      echo "check-banned-patterns: $pattern ($rationale)" >&2
      echo "$output" >&2
      violations=$((violations + 1))
    fi
  fi
done

if (( violations > 0 )); then
  echo "check-banned-patterns: $violations banned pattern(s) found. Remove them or update the list with justification." >&2
  exit 1
fi

echo "check-banned-patterns: clean."
