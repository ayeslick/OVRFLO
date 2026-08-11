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
# This seed runs under real mainnet code-size rules by design: OVRFLOFactory
# no longer embeds any child creation code (children are deployed externally
# via `forge create` and registered with `registerOvrflo`/`registerLending`
# below), so its runtime fits EIP-170 (7,413 B) with no flag needed. This is
# the acceptance gate of
# docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md
# (the 2026-08-10 ticket-08 seed-smoke finding that flag used to work around).
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
# Well-known Anvil/Hardhat default-mnemonic private keys for DEV_WALLET/LENDER_WALLET
# above (accounts #1/#2 of "test test test test test test test test test test test
# junk") — public test-only values, not secrets, used only to sign demo-state
# transactions on the local fork. Override if DEV_WALLET/LENDER_WALLET are overridden.
DEV_PK=${DEV_PK:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}
LENDER_PK=${LENDER_PK:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}
OWNER=$(cast wallet address "$OWNER_PK")

# wstETH is a deliberately fixed choice (see AGENTS.md: "wstETH is the
# correct vault underlying"), not something to discover. The *markets*
# against it are the part that goes stale — see PRIMARY_MARKET/SECONDARY_MARKET
# discovery below.
TREASURY=0x0000000000000000000000000000000000000456
STETH=0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
ORACLE=0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
SABLIER=0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9
TWAP=900
VAULT_NAME="OVRFLO Wrapped Staked Ether"
VAULT_SYMBOL="ovrfloWSTETH"
PT_SEED_AMOUNT=1000000000000000000000   # 1000 * 1e18
STETH_SEED_ETH=200ether
WSTETH_SEED_AMOUNT=60000000000000000000 # 60 * 1e18 per seeded wallet
PENDLE_EXPIRY_BUFFER_DAYS=${PENDLE_EXPIRY_BUFFER_DAYS:-14}
# Demo lending state seeded in step 8 below. LAUNCH_APR_BPS mirrors
# OVRFLOLending's constructor default (10%) — the only valid tick until the
# multisig widens aprMin/aprMax, so the demo deliberately reuses it. Tick
# spacing (25bps) matches the plan's stated per-market default (KTD4/session-
# settled) and evenly divides LAUNCH_APR_BPS.
LENDING_TICK_SPACING=25
LAUNCH_APR_BPS=1000
LENDER_SUPPLY_AMOUNT=5000000000000000000   # 5 * 1e18, UNIT-aligned (UNIT = 1e12)
BORROW_PT_AMOUNT=10000000000000000000     # 10 * 1e18 PT deposited to mint the pledged stream
BORROW_TARGET_AMOUNT=100000000000000000   # 0.1 * 1e18, well under both tick depth and stream price

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN_ID" != "1" ]; then
  echo "seed-local: expected chain id 1 (frontend enforces mainnet), got $CHAIN_ID" >&2
  echo "seed-local: start anvil with --chain-id 1" >&2
  exit 1
fi

FORK_BLOCK=$(cast block-number --rpc-url "$RPC")
FORK_BLOCK_HASH=$(cast block "$FORK_BLOCK" --field hash --rpc-url "$RPC")

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

echo "[1/9] deploy OVRFLOFactory"
FACTORY_JSON=$(
  forge create \
    --rpc-url "$RPC" --private-key "$OWNER_PK" --broadcast --legacy --json \
    src/OVRFLOFactory.sol:OVRFLOFactory \
    --constructor-args "$OWNER" "$ORACLE"
)
FACTORY=$(echo "$FACTORY_JSON" | jq -r '.deployedTo')
FACTORY_TX=$(echo "$FACTORY_JSON" | jq -r '.transactionHash')
if [ -z "$FACTORY_TX" ] || [ "$FACTORY_TX" = "null" ]; then
  echo "seed-local: forge create did not return the factory transaction hash" >&2
  exit 1
fi
echo "      factory = $FACTORY"

echo "[2/9] deploy OVRFLO vault + register with factory"
OVRFLO_JSON=$(
  forge create \
    --rpc-url "$RPC" --private-key "$OWNER_PK" --broadcast --legacy --json \
    src/OVRFLO.sol:OVRFLO \
    --constructor-args "$FACTORY" "$TREASURY" "$WSTETH" "$VAULT_NAME" "$VAULT_SYMBOL" "$ORACLE"
)
OVRFLO=$(echo "$OVRFLO_JSON" | jq -r '.deployedTo')
send "$FACTORY" 'registerOvrflo(address)' "$OVRFLO"
TOKEN=$(cast call --rpc-url "$RPC" "$OVRFLO" 'ovrfloToken()(address)')

# Post-registration verification: confirm the factory's registry agrees with
# what registerOvrflo just wrote (kept from the old deploy()-era reads).
REGISTERED_OVRFLO=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrflos(uint256)(address)' 0)
REGISTERED_TOKEN=$(cast call --rpc-url "$RPC" "$FACTORY" \
  'ovrfloInfo(address)(address,address,address)' "$OVRFLO" \
  | sed -n '3p')
if [ "$(echo "$REGISTERED_OVRFLO" | tr '[:upper:]' '[:lower:]')" != "$(echo "$OVRFLO" | tr '[:upper:]' '[:lower:]')" ] \
  || [ "$(echo "$REGISTERED_TOKEN" | tr '[:upper:]' '[:lower:]')" != "$(echo "$TOKEN" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "seed-local: factory registry disagrees with the deployed vault/token after registerOvrflo" >&2
  exit 1
fi
echo "      ovrflo  = $OVRFLO"
echo "      token   = $TOKEN"

echo "[3/9] prepare oracles for both markets"
send "$FACTORY" 'prepareOracle(address,uint32)' \
  "$PRIMARY_MARKET" "$TWAP"
send "$FACTORY" 'prepareOracle(address,uint32)' \
  "$SECONDARY_MARKET" "$TWAP"

echo "[4/9] approve markets (primary fee=25bps, secondary fee=10bps)"
send "$FACTORY" 'addMarket(address,address,uint32,uint16)' \
  "$OVRFLO" "$PRIMARY_MARKET" "$TWAP" 25
send "$FACTORY" 'addMarket(address,address,uint32,uint16)' \
  "$OVRFLO" "$SECONDARY_MARKET" "$TWAP" 10

echo "[5/9] deploy OVRFLOLending + register with factory"
LENDING_SABLIER=$(cast call --rpc-url "$RPC" "$OVRFLO" 'sablierLL()(address)')
LENDING_JSON=$(
  forge create \
    --rpc-url "$RPC" --private-key "$OWNER_PK" --broadcast --legacy --json \
    src/OVRFLOLending.sol:OVRFLOLending \
    --constructor-args "$FACTORY" "$OVRFLO" "$LENDING_SABLIER"
)
LENDING=$(echo "$LENDING_JSON" | jq -r '.deployedTo')
LENDING_RECEIPT=$(cast send --rpc-url "$RPC" --private-key "$OWNER_PK" --legacy --json \
  "$FACTORY" 'registerLending(address)' "$LENDING")

# Post-registration verification (kept from the old deployLending()-era read).
REGISTERED_LENDING=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrfloToLending(address)(address)' "$OVRFLO")
if [ "$(echo "$REGISTERED_LENDING" | tr '[:upper:]' '[:lower:]')" != "$(echo "$LENDING" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "seed-local: factory.ovrfloToLending does not match the deployed lending market after registerLending" >&2
  exit 1
fi
echo "      lending = $LENDING"

# Onboarding-checklist spacing sanity (U5 security review, plan risk table): the
# tick ladder view (`tickDepths`) is O(rungs), and spacing is set-once per market —
# a pathological small spacing (e.g. 1) permanently blows up the ladder's rung
# count ((aprMax-aprMin)/spacing) into a discovery-time DoS with no recovery path.
# Keep rungs <= ~400. With the launch bounds (aprMin == aprMax == LAUNCH_APR_BPS),
# the ladder is exactly one rung regardless of spacing, so this only matters once
# the multisig widens aprMin/aprMax later — flagging it here, at the only site that
# sets spacing, is cheaper than re-deriving the bound at every future market.
echo "[6/9] set OVRFLOLending tick spacing (both markets, ${LENDING_TICK_SPACING}bps)"
send "$FACTORY" 'setLendingTickSpacing(address,address,uint16)' \
  "$LENDING" "$PRIMARY_MARKET" "$LENDING_TICK_SPACING"
send "$FACTORY" 'setLendingTickSpacing(address,address,uint16)' \
  "$LENDING" "$SECONDARY_MARKET" "$LENDING_TICK_SPACING"

echo "[7/9] seed dev + lender wallets with PT + wstETH"
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

echo "[8/9] seed a lender position and a live loan (full-flow demo state)"
send_as() {
  local pk=$1
  shift
  cast send --rpc-url "$RPC" --private-key "$pk" --legacy "$@" >/dev/null
}

# 8a. Lender rests liquidity at the launch tick (the only valid tick until the
#     multisig widens aprMin/aprMax past LAUNCH_APR_BPS).
send_as "$LENDER_PK" "$WSTETH" 'approve(address,uint256)' "$LENDING" "$LENDER_SUPPLY_AMOUNT"
send_as "$LENDER_PK" "$LENDING" 'supply(address,uint16,uint128)' \
  "$PRIMARY_MARKET" "$LAUNCH_APR_BPS" "$LENDER_SUPPLY_AMOUNT"
echo "      lender supplied $LENDER_SUPPLY_AMOUNT wei at ${LAUNCH_APR_BPS}bps on $PRIMARY_MARKET"

# 8b. Dev wallet deposits PT into the core vault to mint the Sablier stream it
#     will pledge as loan collateral. `deposit` also pulls a fee in underlying.
send_as "$DEV_PK" "$PRIMARY_PT" 'approve(address,uint256)' "$OVRFLO" "$BORROW_PT_AMOUNT"
send_as "$DEV_PK" "$WSTETH" 'approve(address,uint256)' "$OVRFLO" 1000000000000000000
# `cast call` simulates the exact same deposit (no state mutation) purely to read
# the streamId `deposit` will return; the real `cast send` right below is what
# actually creates it, off the same unmutated state.
STREAM_ID=$(cast call --rpc-url "$RPC" --from "$DEV_WALLET" \
  "$OVRFLO" 'deposit(address,uint256,uint256)(uint256,uint256,uint256)' \
  "$PRIMARY_MARKET" "$BORROW_PT_AMOUNT" 0 | sed -n '3p' | awk '{print $1}')
send_as "$DEV_PK" "$OVRFLO" 'deposit(address,uint256,uint256)' \
  "$PRIMARY_MARKET" "$BORROW_PT_AMOUNT" 0
echo "      dev wallet deposited $BORROW_PT_AMOUNT wei PT, minted stream #$STREAM_ID"

# 8c. Pledge the stream and draw against the lender's resting liquidity.
send_as "$DEV_PK" "$SABLIER" 'approve(address,uint256)' "$LENDING" "$STREAM_ID"
send_as "$DEV_PK" "$LENDING" 'borrow(address,uint16,uint128,uint256,uint128)' \
  "$PRIMARY_MARKET" "$LAUNCH_APR_BPS" "$BORROW_TARGET_AMOUNT" "$STREAM_ID" 0
echo "      dev wallet borrowed against stream #$STREAM_ID at ${LAUNCH_APR_BPS}bps"

echo "[9/9] write deployments/local.json"
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
  --argjson forkBlock "$FORK_BLOCK" \
  --arg forkBlockHash "$FORK_BLOCK_HASH" \
  --arg factoryTransactionHash "$FACTORY_TX" \
  --arg lendingTransactionHash "$(echo "$LENDING_RECEIPT" | jq -r '.transactionHash')" \
  '{
    formatVersion: 1,
    projectionSchemaVersion: 1,
    abiVersion: 1,
    freshGeneration: true,
    chainId: 1,
    forkBlock: $forkBlock,
    forkBlockHash: $forkBlockHash,
    factory: $factory,
    factoryTransactionHash: $factoryTransactionHash,
    ovrflo: $ovrflo,
    token: $token,
    lending: $lending,
    lendingTransactionHash: $lendingTransactionHash,
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

DEPLOYMENT_RPC_URL="$RPC" node tools/scripts/write-deployment-artifact.mjs deployments/local.json

echo
echo "=== OVRFLO seed complete ==="
echo "factory:   $FACTORY"
echo "ovrflo:    $OVRFLO"
echo "token:     $TOKEN"
echo "lending:   $LENDING"
echo "devWallet: $DEV_WALLET"
echo "lender:    $LENDER_WALLET"
echo "artifact:  deployments/local.json"
echo "demo loan: stream #$STREAM_ID, ${LAUNCH_APR_BPS}bps on $PRIMARY_MARKET (cast call \"$LENDING\" 'tickDepths(address)((uint16,uint128)[])' \"$PRIMARY_MARKET\" to inspect the ladder)"
