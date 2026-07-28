#!/usr/bin/env bash
# repin-fork-fixtures.sh — refresh the pinned mainnet-fork block + Pendle
# wstETH markets baked into script/lib/OVRFLOTestFixtures.sol.
#
# test/fork/*.t.sol intentionally stay pinned to a fixed historical block
# (via `vm.createSelectFork(rpc, MAINNET_FORK_BLOCK)`) for deterministic,
# reproducible tests — pinning itself is correct and does NOT go stale with
# wall-clock time. What used to go stale was *how the pin was chosen*: a
# specific market address hand-picked once and never revisited. This script
# turns that into a scripted, occasional maintenance action instead of a
# manual investigation — run it, review the diff, commit it, the same as
# bumping any other pinned test fixture.
#
# Usage (from repo root): MAINNET_RPC_URL=... ./script/repin-fork-fixtures.sh
#
# Overrides: PENDLE_EXPIRY_BUFFER_DAYS (default 14, matching seed-local.sh),
# FORK_BLOCK_SAFETY_MARGIN (blocks behind head, default 50 -- ~10min on
# mainnet -- as cheap insurance against querying a block that gets
# reorged out moments after this script reads it).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/discover-pendle-market.sh
source "$SCRIPT_DIR/lib/discover-pendle-market.sh"

FIXTURES_FILE="$SCRIPT_DIR/lib/OVRFLOTestFixtures.sol"
RPC=${MAINNET_RPC_URL:-}
PENDLE_EXPIRY_BUFFER_DAYS=${PENDLE_EXPIRY_BUFFER_DAYS:-14}
FORK_BLOCK_SAFETY_MARGIN=${FORK_BLOCK_SAFETY_MARGIN:-50}

if [ -z "$RPC" ]; then
  echo "repin-fork-fixtures: MAINNET_RPC_URL is not set" >&2
  exit 1
fi

add_underscores() {
  # Matches this file's existing digit-grouped literal style (e.g. 1_782_345_600).
  echo "$1" | rev | sed 's/\(.\{3\}\)/\1_/g' | rev | sed 's/^_//'
}

echo "repin-fork-fixtures: picking a safe recent mainnet block..."
HEAD_BLOCK=$(cast block-number --rpc-url "$RPC")
SAFE_BLOCK=$((HEAD_BLOCK - FORK_BLOCK_SAFETY_MARGIN))
BLOCK_TIMESTAMP=$(cast block "$SAFE_BLOCK" --field timestamp --rpc-url "$RPC")
echo "      block     = $SAFE_BLOCK (timestamp $BLOCK_TIMESTAMP)"

echo "repin-fork-fixtures: discovering live wstETH Pendle markets (expiry > block time + ${PENDLE_EXPIRY_BUFFER_DAYS}d)..."
CUTOFF=$((BLOCK_TIMESTAMP + PENDLE_EXPIRY_BUFFER_DAYS * 24 * 60 * 60))
ALL_MARKETS_JSON=$(pendle_fetch_all_markets)
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
DISCOVERED=$(pendle_discover_top2_markets "$ALL_MARKETS_JSON" "$WSTETH" "$CUTOFF")
DISCOVERED_COUNT=$(echo "$DISCOVERED" | grep -c . || true)
if [ "$DISCOVERED_COUNT" -lt 2 ]; then
  echo "repin-fork-fixtures: found only $DISCOVERED_COUNT wstETH Pendle market(s) with expiry > block time + ${PENDLE_EXPIRY_BUFFER_DAYS}d (need 2)" >&2
  echo "repin-fork-fixtures: check connectivity to api-v2.pendle.finance, or lower PENDLE_EXPIRY_BUFFER_DAYS if the live pool is thin right now" >&2
  exit 1
fi

PRIMARY_LINE=$(echo "$DISCOVERED" | sed -n '1p')
SECONDARY_LINE=$(echo "$DISCOVERED" | sed -n '2p')
PRIMARY_MARKET=$(cast to-check-sum-address "$(echo "$PRIMARY_LINE" | cut -f1)")
PRIMARY_PT=$(cast to-check-sum-address "$(echo "$PRIMARY_LINE" | cut -f2)")
PRIMARY_EXPIRY=$(add_underscores "$(echo "$PRIMARY_LINE" | cut -f3)")
SECONDARY_MARKET=$(cast to-check-sum-address "$(echo "$SECONDARY_LINE" | cut -f1)")
SECONDARY_PT=$(cast to-check-sum-address "$(echo "$SECONDARY_LINE" | cut -f2)")
SECONDARY_EXPIRY=$(add_underscores "$(echo "$SECONDARY_LINE" | cut -f3)")
FORK_BLOCK_FORMATTED=$(add_underscores "$SAFE_BLOCK")
echo "      primary   = $PRIMARY_MARKET (pt $PRIMARY_PT, expires $PRIMARY_EXPIRY)"
echo "      secondary = $SECONDARY_MARKET (pt $SECONDARY_PT, expires $SECONDARY_EXPIRY)"

echo "repin-fork-fixtures: writing $FIXTURES_FILE..."
perl -pi \
  -e "s/(address internal constant PRIMARY_MARKET = )[^;]+;/\${1}$PRIMARY_MARKET;/;" \
  -e "s/(address internal constant PRIMARY_PT = )[^;]+;/\${1}$PRIMARY_PT;/;" \
  -e "s/(uint256 internal constant PRIMARY_EXPIRY = )[^;]+;/\${1}$PRIMARY_EXPIRY;/;" \
  -e "s/(address internal constant SECONDARY_MARKET = )[^;]+;/\${1}$SECONDARY_MARKET;/;" \
  -e "s/(address internal constant SECONDARY_PT = )[^;]+;/\${1}$SECONDARY_PT;/;" \
  -e "s/(uint256 internal constant SECONDARY_EXPIRY = )[^;]+;/\${1}$SECONDARY_EXPIRY;/;" \
  -e "s/(uint256 internal constant MAINNET_FORK_BLOCK = )[^;]+;/\${1}$FORK_BLOCK_FORMATTED;/;" \
  "$FIXTURES_FILE"

echo
echo "=== repin complete ==="
echo "Review the diff (forge build to confirm it still compiles), then run"
echo "test/fork/*.t.sol against \$MAINNET_RPC_URL before committing:"
echo "  forge test --match-path \"test/fork/*\" --fork-url \$MAINNET_RPC_URL"
