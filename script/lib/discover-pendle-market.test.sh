#!/usr/bin/env bash
# discover-pendle-market.test.sh — plain-bash smoke test for the pure
# filter/selection logic in discover-pendle-market.sh. No network access:
# feeds a hand-written fixture (testdata/pendle-markets-fixture.json) through
# pendle_discover_top2_markets and asserts the exact expected TSV output.
#
# Run directly: bash script/lib/discover-pendle-market.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./discover-pendle-market.sh
source "$SCRIPT_DIR/discover-pendle-market.sh"

FIXTURE_JSON="$(cat "$SCRIPT_DIR/testdata/pendle-markets-fixture.json")"
WSTETH="0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" # deliberately mixed-case; filter must lowercase
CUTOFF="1798761600" # 2027-01-01T00:00:00Z

# Fixture has 5 candidate markets designed so each filter dimension matters
# independently:
#   A (liquidity 5,000,000, expiry 2030) -> wstETH, valid expiry -> rank 1
#   B (liquidity 2,000,000, expiry 2028)  -> wstETH, valid expiry -> rank 2
#   C (liquidity 1,000,000, expiry 2027)  -> wstETH, valid expiry, but lowest
#                                            liquidity of the three -> truncated by top-2
#   D (liquidity 8,000,000, expiry 2026)  -> wstETH, but expiry < cutoff ->
#                                            excluded despite huge liquidity
#   E (liquidity 9,999,999, expiry 2030)  -> valid expiry, but wrong
#                                            underlying -> excluded despite huge liquidity
EXPECTED="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa	0x1111111111111111111111111111111111111a	1893456000
0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb	0x2222222222222222222222222222222222222b	1843430400"

ACTUAL="$(pendle_discover_top2_markets "$WSTETH" "$CUTOFF" <<<"$FIXTURE_JSON")"

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "FAIL: pendle_discover_top2_markets output mismatch" >&2
  echo "--- expected ---" >&2
  echo "$EXPECTED" >&2
  echo "--- actual ---" >&2
  echo "$ACTUAL" >&2
  exit 1
fi

echo "PASS: pendle_discover_top2_markets (underlying filter, expiry filter, liquidity sort + top-2 truncation all verified independently)"
