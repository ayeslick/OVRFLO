#!/usr/bin/env bash
# discover-pendle-market.sh — pure filtering/selection logic for picking live
# Pendle PT markets against a given underlying, so seeding/repin scripts
# never hardcode a specific market address whose expiry eventually passes
# wall-clock "now" (see docs/solutions/architecture-patterns for the
# writeup of why script/seed-local.sh's old hardcoded PRIMARY_MARKET went
# stale).
#
# Sourced by script/seed-local.sh (discovers fresh markets on every local
# bootstrap, since it forks the *live* chain head) and
# script/repin-fork-fixtures.sh (discovers markets to pin into
# script/lib/OVRFLOTestFixtures.sol, whose mainnet-fork tests stay pinned to
# a fixed historical block for determinism — only the *process* of choosing
# what to pin is scripted here, not the pin itself).
#
# Dependency-free beyond curl/jq, which script/seed-local.sh already
# requires. Addresses in/out are lowercase, matching Pendle's own API
# casing; callers that need EIP-55 checksummed addresses (e.g. for writing
# into .sol source) are responsible for that via `cast to-check-sum-address`.

set -euo pipefail

PENDLE_API_BASE=${PENDLE_API_BASE:-https://api-v2.pendle.finance/core/v2/markets/all}
PENDLE_PAGE_LIMIT=${PENDLE_PAGE_LIMIT:-100}

# Fetches every page of Pendle's cross-chain markets/all endpoint and prints
# the combined `results` array as one JSON array to stdout.
pendle_fetch_all_markets() {
  local skip=0
  local combined="[]"
  local page page_results total
  while true; do
    page=$(curl -sf "${PENDLE_API_BASE}?limit=${PENDLE_PAGE_LIMIT}&skip=${skip}")
    page_results=$(jq -c '.results' <<<"$page")
    combined=$(jq -c -n --argjson a "$combined" --argjson b "$page_results" '$a + $b')
    total=$(jq -r '.total' <<<"$page")
    skip=$((skip + PENDLE_PAGE_LIMIT))
    if [ "$skip" -ge "$total" ]; then
      break
    fi
  done
  echo "$combined"
}

# Given a Pendle markets JSON array (as produced by pendle_fetch_all_markets
# or an equivalent fixture) on $1, an underlying asset address on $2, and a
# cutoff unix timestamp on $3, prints the top-2 qualifying markets (sorted by
# liquidity descending) as TSV: market<TAB>pt<TAB>expiry(unix).
#
# Qualifying = underlyingAsset matches (chain 1, case-insensitive) AND expiry
# is strictly after the cutoff. Pendle's `expiry` field is ISO8601 with a
# millisecond suffix ("...000Z"), which jq's strict `fromdateiso8601` rejects
# outright — stripping everything from the first "." and re-appending "Z"
# sidesteps that without needing the shell's own `date`, whose ISO-parsing
# flags differ between BSD (macOS) and GNU (Linux) and would otherwise force
# an OS-detection branch here.
pendle_discover_top2_markets() {
  local markets_json="$1"
  local underlying="$2"
  local cutoff="$3"
  local underlying_lc
  underlying_lc=$(tr '[:upper:]' '[:lower:]' <<<"$underlying")

  jq -r \
    --arg underlying "1-${underlying_lc}" \
    --argjson cutoff "$cutoff" \
    '
      map(
        . + {
          _expiryUnix: (.expiry | split(".")[0] + "Z" | fromdateiso8601),
          _pt: (.pt | split("-")[1])
        }
      )
      | map(select(.underlyingAsset == $underlying))
      | map(select(._expiryUnix > $cutoff))
      | sort_by(-.details.liquidity)
      | .[0:2]
      | .[]
      | [.address, ._pt, (._expiryUnix | tostring)]
      | @tsv
    ' <<<"$markets_json"
}
