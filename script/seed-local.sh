#!/usr/bin/env bash
# seed-local.sh — deploy + approve + seed OVRFLO on a local anvil fork.
#
# Why not a `forge script --broadcast`? The broadcast validator queries
# account state via `eth_getAccountInfo`, which anvil in fork mode
# currently returns `{balance:0, nonce:0}` for (foundry#11714). Every
# tx then gets rejected as `lack of funds (0) for max fee (...)`. This
# driver sidesteps the validator entirely by going through
# `forge create` / `cast send` / `anvil_setStorageAt`, whose code
# paths are not regressed.
#
# Usage (from repo root):
#   anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1
#   ./script/seed-local.sh
#
# Which two Pendle wstETH markets get seeded is discovered live on every run
# (see lib/discover-pendle-market.sh), not hardcoded — this script forks the
# *live* chain head (no --fork-block-number pin), so a hardcoded market
# would eventually expire relative to real wall-clock time. Contrast with
# test/fork/*.t.sol, which pin a fixed historical block via
# script/lib/OVRFLOTestFixtures.sol and are refreshed only occasionally via
# script/repin-fork-fixtures.sh.
#
# Overrides: PRIVATE_KEY, DEV_WALLET, LENDER_WALLET, RPC, PENDLE_EXPIRY_BUFFER_DAYS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/discover-pendle-market.sh
source "$SCRIPT_DIR/lib/discover-pendle-market.sh"

RPC=${RPC:-http://127.0.0.1:8545}
OWNER_PK=${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
DEV_WALLET=${DEV_WALLET:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}
LENDER_WALLET=${LENDER_WALLET:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}
OWNER=$(cast wallet address "$OWNER_PK")

# wstETH is a deliberately fixed choice (see AGENTS.md: "wstETH is the
# correct vault underlying"), not something to discover. The *markets*
# against it are the part that goes stale — see PRIMARY_MARKET/SECONDARY_MARKET
# discovery below.
TREASURY=0x0000000000000000000000000000000000000456
STETH=0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
ORACLE=0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
TWAP=900
NAME_SUFFIX="Wrapped Staked Ether"
SYMBOL_SUFFIX="WSTETH"
PT_SEED_AMOUNT=1000000000000000000000   # 1000 * 1e18
STETH_SEED_ETH=200ether
WSTETH_SEED_AMOUNT=60000000000000000000 # 60 * 1e18 per seeded wallet
PENDLE_EXPIRY_BUFFER_DAYS=${PENDLE_EXPIRY_BUFFER_DAYS:-14}

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN_ID" != "1" ]; then
  echo "seed-local: expected chain id 1 (frontend enforces mainnet), got $CHAIN_ID" >&2
  echo "seed-local: start anvil with --chain-id 1" >&2
  exit 1
fi

BLOCK_TIMESTAMP=$(cast block latest --field timestamp --rpc-url "$RPC")

echo "seed-local: discovering live wstETH Pendle markets (expiry > now + ${PENDLE_EXPIRY_BUFFER_DAYS}d)..."
CUTOFF=$((BLOCK_TIMESTAMP + PENDLE_EXPIRY_BUFFER_DAYS * 24 * 60 * 60))
DISCOVERED=$(pendle_fetch_all_markets | pendle_discover_top2_markets "$WSTETH" "$CUTOFF")
DISCOVERED_COUNT=$(echo "$DISCOVERED" | grep -c . || true)
if [ "$DISCOVERED_COUNT" -lt 2 ]; then
  echo "seed-local: found only $DISCOVERED_COUNT wstETH Pendle market(s) with expiry > now + ${PENDLE_EXPIRY_BUFFER_DAYS}d (need 2)" >&2
  echo "seed-local: check connectivity to api-v2.pendle.finance, or lower PENDLE_EXPIRY_BUFFER_DAYS if the live pool is thin right now" >&2
  exit 1
fi

PRIMARY_LINE=$(echo "$DISCOVERED" | sed -n '1p')
SECONDARY_LINE=$(echo "$DISCOVERED" | sed -n '2p')
PRIMARY_MARKET=$(cast to-check-sum-address "$(echo "$PRIMARY_LINE" | cut -f1)")
PRIMARY_PT=$(cast to-check-sum-address "$(echo "$PRIMARY_LINE" | cut -f2)")
PRIMARY_EXPIRY=$(echo "$PRIMARY_LINE" | cut -f3)
SECONDARY_MARKET=$(cast to-check-sum-address "$(echo "$SECONDARY_LINE" | cut -f1)")
SECONDARY_PT=$(cast to-check-sum-address "$(echo "$SECONDARY_LINE" | cut -f2)")
SECONDARY_EXPIRY=$(echo "$SECONDARY_LINE" | cut -f3)
echo "      primary   = $PRIMARY_MARKET (pt $PRIMARY_PT, expires $PRIMARY_EXPIRY)"
echo "      secondary = $SECONDARY_MARKET (pt $SECONDARY_PT, expires $SECONDARY_EXPIRY)"

mkdir -p deployments

send() {
  cast send --rpc-url "$RPC" --private-key "$OWNER_PK" --legacy "$@" >/dev/null
}

echo "seed-local: owner      = $OWNER"
echo "seed-local: dev wallet = $DEV_WALLET"
echo "seed-local: lender     = $LENDER_WALLET"
echo

echo "[1/7] deploy OVRFLOFactory"
FACTORY_JSON=$(
  forge create \
    --rpc-url "$RPC" --private-key "$OWNER_PK" --broadcast --legacy --json \
    src/OVRFLOFactory.sol:OVRFLOFactory \
    --constructor-args "$OWNER" "$ORACLE"
)
FACTORY=$(echo "$FACTORY_JSON" | jq -r '.deployedTo')
echo "      factory = $FACTORY"

echo "[2/7] configure + deploy OVRFLO + OVRFLOToken"
send "$FACTORY" \
  'configureDeployment(address,address,string,string)' \
  "$TREASURY" "$WSTETH" "$NAME_SUFFIX" "$SYMBOL_SUFFIX"
send "$FACTORY" 'deploy()'
OVRFLO=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrflos(uint256)(address)' 0)
TOKEN=$(cast call --rpc-url "$RPC" "$FACTORY" \
  'ovrfloInfo(address)(address,address,address)' "$OVRFLO" \
  | sed -n '3p')
echo "      ovrflo  = $OVRFLO"
echo "      token   = $TOKEN"

echo "[3/7] prepare oracles for both markets"
send "$FACTORY" 'prepareOracle(address,uint32)' \
  "$PRIMARY_MARKET" "$TWAP"
send "$FACTORY" 'prepareOracle(address,uint32)' \
  "$SECONDARY_MARKET" "$TWAP"

echo "[4/7] approve markets (primary fee=25bps, secondary fee=10bps)"
send "$FACTORY" 'addMarket(address,address,uint32,uint16)' \
  "$OVRFLO" "$PRIMARY_MARKET" "$TWAP" 25
send "$FACTORY" 'addMarket(address,address,uint32,uint16)' \
  "$OVRFLO" "$SECONDARY_MARKET" "$TWAP" 10

echo "[5/7] deploy OVRFLOLending"
send "$FACTORY" 'deployLending(address)' "$OVRFLO"
LENDING=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrfloToLending(address)(address)' "$OVRFLO")
echo "      lending = $LENDING"

echo "[6/7] seed dev + lender wallets with PT + wstETH"
# Pendle PT inherits OZ ERC20, so balances live in mapping at slot 0.
AMOUNT_HEX=$(cast to-uint256 "$PT_SEED_AMOUNT")
for WALLET in "$DEV_WALLET" "$LENDER_WALLET"; do
  PT_SLOT=$(cast index address "$WALLET" 0)
  cast rpc --rpc-url "$RPC" anvil_setStorageAt \
    "$PRIMARY_PT" "$PT_SLOT" "$AMOUNT_HEX" >/dev/null
  cast rpc --rpc-url "$RPC" anvil_setStorageAt \
    "$SECONDARY_PT" "$PT_SLOT" "$AMOUNT_HEX" >/dev/null
  for PT in "$PRIMARY_PT" "$SECONDARY_PT"; do
    BAL=$(cast call --rpc-url "$RPC" "$PT" 'balanceOf(address)(uint256)' "$WALLET" \
      | awk '{print $1}')
    if [ "$BAL" != "$PT_SEED_AMOUNT" ]; then
      echo "      PT $PT: balance slot is NOT 0 for $WALLET (got $BAL, expected $PT_SEED_AMOUNT)" >&2
      echo "      probe the correct slot with cast storage and update PT_SLOT" >&2
      exit 1
    fi
  done
done
echo "      PT balances planted (slot 0)"

send --value "$STETH_SEED_ETH" "$STETH" \
  'submit(address)' 0x0000000000000000000000000000000000000000
STETH_BAL=$(cast call --rpc-url "$RPC" "$STETH" \
  'balanceOf(address)(uint256)' "$OWNER" | awk '{print $1}')
send "$STETH" 'approve(address,uint256)' "$WSTETH" "$STETH_BAL"
send "$WSTETH" 'wrap(uint256)' "$STETH_BAL"
WSTETH_BAL=$(cast call --rpc-url "$RPC" "$WSTETH" \
  'balanceOf(address)(uint256)' "$OWNER" | awk '{print $1}')
send "$WSTETH" 'transfer(address,uint256)' "$DEV_WALLET" "$WSTETH_SEED_AMOUNT"
send "$WSTETH" 'transfer(address,uint256)' "$LENDER_WALLET" "$WSTETH_SEED_AMOUNT"
echo "      wstETH seeded ($WSTETH_SEED_AMOUNT wei each; owner wrapped $WSTETH_BAL wei)"

echo "[7/7] write deployments/local.json"
jq -n \
  --arg factory   "$FACTORY" \
  --arg ovrflo    "$OVRFLO" \
  --arg token     "$TOKEN" \
  --arg lending   "$LENDING" \
  --arg devWallet "$DEV_WALLET" \
  --arg lenderWallet "$LENDER_WALLET" \
  --arg primaryMarket "$PRIMARY_MARKET" \
  --arg primaryPt "$PRIMARY_PT" \
  --argjson primaryExpiry "$PRIMARY_EXPIRY" \
  --arg secondaryMarket "$SECONDARY_MARKET" \
  --arg secondaryPt "$SECONDARY_PT" \
  --argjson secondaryExpiry "$SECONDARY_EXPIRY" \
  '{
    chainId: 1,
    factory: $factory,
    ovrflo: $ovrflo,
    token: $token,
    lending: $lending,
    devWallet: $devWallet,
    lenderWallet: $lenderWallet,
    primaryMarket: $primaryMarket,
    primaryPt: $primaryPt,
    primaryExpiry: $primaryExpiry,
    secondaryMarket: $secondaryMarket,
    secondaryPt: $secondaryPt,
    secondaryExpiry: $secondaryExpiry
  }' \
  > deployments/local.json

echo
echo "=== OVRFLO seed complete ==="
echo "factory:   $FACTORY"
echo "ovrflo:    $OVRFLO"
echo "token:     $TOKEN"
echo "lending:   $LENDING"
echo "devWallet: $DEV_WALLET"
echo "lender:    $LENDER_WALLET"
echo "artifact:  deployments/local.json"
