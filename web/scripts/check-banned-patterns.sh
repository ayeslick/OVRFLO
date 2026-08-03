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
  # Historical scans belong only in lib/discovery (plus U1 deployment-anchor verification).
  'FACTORY_FROM_BLOCK|Ad hoc log-scan anchors are banned; use the verified deployment artifact and centralized discovery scanner.'
  'useApprovedMarkets|Replaced by useAllMarkets; do not reintroduce an approved-only filter.'
  'parseStreamError|Superseded by classifyUserError / StreamScanError; remove stragglers.'
  'watchContractEvent.*Deposited|Ad hoc event scans are banned; use lib/discovery.'
  'getLogs.*Deposited|Ad hoc event scans are banned; use lib/discovery.'
  'nativeUsd|Renamed/removed; use the price API surface in lib/prices.'
  'Number\\([^)]*(amount|balance|liquidity|obligation|drawn|repaid|proceeds|price|outstanding|contribution)|Do not cast token amounts through Number; keep money values as bigint.'
  # Product framing OVRFLO does not implement. Every region brief in docs/maps/ui/
  # bans it (CODING_STANDARD.md CS-P1); these identifier and copy forms are the
  # slice a grep can decide. One entry per term: the array splits on the first
  # "|", so a pattern may not use regex alternation.
  'healthFactor|OVRFLO has no health factor (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'HEALTH FACTOR|OVRFLO has no health factor (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'liquidationPrice|OVRFLO has no liquidation (docs/maps/ui/CODING_STANDARD.md CS-P1).'
  'collateralRatio|OVRFLO has no collateral ratio (docs/maps/ui/CODING_STANDARD.md CS-P1).'
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
      "$WEB_ROOT/lib/discovery/"*|"$WEB_ROOT/lib/deployment.ts:"*) ;;
      *)
        echo "$line"
        found=0
        ;;
    esac
  done
  return "$found"
}

violations=0
for entry in "${PATTERNS[@]}"; do
  pattern="${entry%%|*}"
  rationale="${entry#*|}"
  # The discovery scanner and deployment-anchor verifier are the only
  # reviewed owners of historical-log access.  All other guard patterns,
  # including those that happen to be used by discovery projections, apply
  # to every production root.
  historical_owner_exception=0
  case "$pattern" in
    FACTORY_FROM_BLOCK|watchContractEvent.*Deposited|getLogs.*Deposited)
      historical_owner_exception=1
      ;;
  esac
  if [[ "$SEARCH_CMD" == "rg" ]]; then
    # Exit 1 from rg means "no matches", which is success here.
    rg_args=(--line-number --with-filename --no-heading --color=never
      --glob '!*.test.*' --glob '!*.spec.*')
    if (( historical_owner_exception )); then
      if output=$(rg "${rg_args[@]}" "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null \
        | filter_historical_owners); then
        echo "check-banned-patterns: $pattern ($rationale)" >&2
        echo "$output" >&2
        violations=$((violations + 1))
      fi
    elif output=$(rg "${rg_args[@]}" "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null); then
      echo "check-banned-patterns: $pattern ($rationale)" >&2
      echo "$output" >&2
      violations=$((violations + 1))
    fi
  else
    # POSIX grep fallback: recursive, extended regex, exclude tests.
    grep_args=(-rnE --exclude='*.test.*' --exclude='*.spec.*')
    if (( historical_owner_exception )); then
      # Filter only the precise approved paths.  Do not use --exclude-dir:
      # that would wrongly exempt any directory named "discovery".
      if output=$(grep "${grep_args[@]}" "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null \
        | filter_historical_owners); then
        echo "check-banned-patterns: $pattern ($rationale)" >&2
        echo "$output" >&2
        violations=$((violations + 1))
      fi
    elif output=$(grep "${grep_args[@]}" "$pattern" "${EXISTING_ROOTS[@]}" 2>/dev/null); then
      echo "check-banned-patterns: $pattern ($rationale)" >&2
      echo "$output" >&2
      violations=$((violations + 1))
    fi
  fi
done

# Any new historical-log caller outside the two reviewed owners is a violation,
# even when it does not mention Deposited on the same line.
if [[ "$SEARCH_CMD" == "rg" ]]; then
  if output=$(rg --line-number --with-filename --no-heading --color=never \
    --glob '!*.test.*' --glob '!*.spec.*' \
    'getLogs|eth_getLogs|watchContractEvent|watchEvent' "${EXISTING_ROOTS[@]}" 2>/dev/null \
    | filter_historical_owners); then
    echo "check-banned-patterns: ad hoc historical scan (Use web/lib/discovery; deployment.ts is the anchor-verification exception.)" >&2
    echo "$output" >&2
    violations=$((violations + 1))
  fi
else
  if output=$(grep -rnE \
    --exclude='*.test.*' --exclude='*.spec.*' \
    'getLogs|eth_getLogs|watchContractEvent|watchEvent' "${EXISTING_ROOTS[@]}" 2>/dev/null \
    | filter_historical_owners); then
    echo "check-banned-patterns: ad hoc historical scan (Use web/lib/discovery; deployment.ts is the anchor-verification exception.)" >&2
    echo "$output" >&2
    violations=$((violations + 1))
  fi
fi

if (( violations > 0 )); then
  echo "check-banned-patterns: $violations banned pattern(s) found. Remove them or update the list with justification." >&2
  exit 1
fi

echo "check-banned-patterns: clean."
