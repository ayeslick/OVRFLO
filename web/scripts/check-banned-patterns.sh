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

# Pattern ":::" rationale (one-liner used in the failure message). The
# separator is deliberately not "|": regex alternation is common here, and a
# single-pipe split silently truncated the money-cast entry into an
# uncompilable regex that reported "clean" for as long as it existed.
SEPARATOR=':::'
PATTERNS=(
  # Historical scans belong only in U1 deployment-anchor verification.
  'FACTORY_FROM_BLOCK:::Ad hoc log-scan anchors are banned; use the verified deployment artifact.'
  'useApprovedMarkets:::Replaced by useAllMarkets; do not reintroduce an approved-only filter.'
  'parseStreamError:::Superseded by classifyUserError / StreamScanError; remove stragglers.'
  'watchContractEvent.*Deposited:::Ad hoc event scans are banned; use lib/discovery.'
  'getLogs.*Deposited:::Ad hoc event scans are banned; use lib/discovery.'
  'nativeUsd:::Renamed/removed; use the price API surface in lib/prices.'
  # Leading [Aa]-style classes, not (?i): the grep fallback is POSIX ERE and
  # has no inline case-insensitive flag.  camelCase suffixes (marketAmount,
  # totalBalance) are the common real form, so matching only lowercase would
  # miss almost every violation.
  'Number\([^)]*([Aa]mount|[Bb]alance|[Ll]iquidity|[Oo]bligation|[Dd]rawn|[Rr]epaid|[Pp]roceeds|[Pp]rice|[Oo]utstanding|[Cc]ontribution):::Do not cast token amounts through Number; keep money values as bigint.'
  # Product framing OVRFLO does not implement. Every region brief in docs/maps/ui/
  # bans it (CODING_STANDARD.md CS-P1); these identifier and copy forms are the
  # slice a grep can decide.
  'healthFactor:::OVRFLO has no health factor (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'HEALTH FACTOR:::OVRFLO has no health factor (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'liquidationPrice:::OVRFLO has no liquidation (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'collateralRatio:::OVRFLO has no collateral ratio (docs/maps/ui/CODING_STANDARD.md CS-P1).'
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

filter_historical_owners() {
  local line
  local found=1
  while IFS= read -r line; do
    case "$line" in
      "$WEB_ROOT/lib/deployment.ts:"*) ;;
      *)
        echo "$line"
        found=0
        ;;
    esac
  done
  return "$found"
}

# Runs the configured searcher for one pattern.  Emits matching lines on
# stdout; returns 0 for "matched", 1 for "no match", 2 for "the searcher
# failed".  Searcher stderr is deliberately not discarded: a pattern that
# does not compile must be loud, not silently clean.
run_search() {
  local pattern="$1"
  local status=0
  if [[ "$SEARCH_CMD" == "rg" ]]; then
    rg --line-number --with-filename --no-heading --color=never \
      --glob '!*.test.*' --glob '!*.spec.*' \
      -e "$pattern" "${EXISTING_ROOTS[@]}" || status=$?
  else
    # POSIX grep fallback: recursive, extended regex, exclude tests.
    grep -rnE --exclude='*.test.*' --exclude='*.spec.*' \
      -e "$pattern" "${EXISTING_ROOTS[@]}" || status=$?
  fi
  if (( status > 1 )); then
    return 2
  fi
  return "$status"
}

# Reports every match for one pattern, minus the reviewed historical-log
# owners when the pattern is one they are allowed to use.  Returns 0 when a
# violation was reported.
report_violations() {
  local pattern="$1" label="$2" apply_owner_filter="$3"
  local raw="" filtered status=0

  raw=$(run_search "$pattern") || status=$?
  if (( status == 2 )); then
    echo "check-banned-patterns: search failed for pattern: $pattern" >&2
    exit 1
  fi
  if (( status != 0 )); then
    return 1
  fi

  if (( apply_owner_filter )); then
    # Filter only the precise approved paths.  Do not use --exclude-dir:
    # that would wrongly exempt any directory named "discovery".
    filtered=$(printf '%s\n' "$raw" | filter_historical_owners) || return 1
    raw="$filtered"
  fi

  echo "check-banned-patterns: $label" >&2
  echo "$raw" >&2
  return 0
}

violations=0
for entry in "${PATTERNS[@]}"; do
  pattern="${entry%%"$SEPARATOR"*}"
  rationale="${entry#*"$SEPARATOR"}"
  # The deployment-anchor verifier is the only reviewed owner of
  # historical-log access.  All other guard patterns, including those that
  # happen to be used by discovery projections, apply to every production root.
  historical_owner_exception=0
  case "$pattern" in
    FACTORY_FROM_BLOCK|watchContractEvent.*Deposited|getLogs.*Deposited)
      historical_owner_exception=1
      ;;
  esac
  if report_violations "$pattern" "$pattern ($rationale)" "$historical_owner_exception"; then
    violations=$((violations + 1))
  fi
done

# Any new historical-log caller outside the deployment-anchor verifier is a
# violation, even when it does not mention Deposited on the same line.
if report_violations 'getLogs|eth_getLogs|watchContractEvent|watchEvent' \
  'ad hoc historical scan (deployment.ts is the anchor-verification exception.)' 1; then
  violations=$((violations + 1))
fi

if (( violations > 0 )); then
  echo "check-banned-patterns: $violations banned pattern(s) found. Remove them or update the list with justification." >&2
  exit 1
fi

echo "check-banned-patterns: clean."
