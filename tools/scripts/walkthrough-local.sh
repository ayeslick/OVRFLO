#!/usr/bin/env bash
# Ticket 10 gate: scripted two-wallet walkthrough on the local fork.
set -euo pipefail
RPC=http://127.0.0.1:8545
# Deployment addresses come from the live seed artifact: seed-local.sh
# discovers Pendle markets live, so every reseed deploys at new addresses —
# hardcoding them makes the walkthrough silently target a dead deployment.
# This script also assumes a FRESH seed (it relies on liquidity ids 1-4 and
# loan id 1): run it right after bootstrap:local, before anything else writes.
DEPLOYMENT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/deployments/local.json
FACTORY=$(jq -r .factory "$DEPLOYMENT")
OVRFLO=$(jq -r .ovrflo "$DEPLOYMENT")
LENDING=$(jq -r .lending "$DEPLOYMENT")
MARKET=$(jq -r .primaryMarket "$DEPLOYMENT")
PT=$(jq -r .primaryPt "$DEPLOYMENT")
TOKEN=$(jq -r .token "$DEPLOYMENT")
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
# SABLIER= keeps its name. The value is the seeded lockup, derived on the artifact.
SABLIER=$(jq -r .stream "$DEPLOYMENT")
if [ -z "$SABLIER" ] || [ "$SABLIER" = "null" ]; then
  echo "walkthrough-local: deployments/local.json is missing stream. Re-run seed-local.sh." >&2
  exit 1
fi
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEV_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
LENDER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
DEV=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

step() { echo; echo "== $1"; }
send() { local pk=$1; shift; cast send --rpc-url $RPC --private-key "$pk" "$@" >/dev/null; }

step "0. widen APR bounds so the ladder has two rates (owner via factory)"
send $OWNER_PK $FACTORY 'setLendingAprBounds(address,uint16,uint16)' $LENDING 1000 1200
echo "bounds: $(cast call $LENDING 'aprMinBps()(uint16)' --rpc-url $RPC)-$(cast call $LENDING 'aprMaxBps()(uint16)' --rpc-url $RPC)"

step "1. LENDER supplies at two different rates (0.3 @10%, 10 @11%)"
send $LENDER_PK $WSTETH 'approve(address,uint256)' $LENDING 20000000000000000000
send $LENDER_PK $LENDING 'supplyLiquidity(address,uint16,uint128)' $MARKET 1000 300000000000000000
send $LENDER_PK $LENDING 'supplyLiquidity(address,uint16,uint128)' $MARKET 1100 10000000000000000000
echo "liquidity 1 (10.00%): $(cast call $LENDING 'liquidityPositions(uint256)(address,address,uint16,uint128)' 1 --rpc-url $RPC | sed -n 4p)"
echo "liquidity 2 (11.00%): $(cast call $LENDING 'liquidityPositions(uint256)(address,address,uint16,uint128)' 2 --rpc-url $RPC | sed -n 4p)"

step "2. DEV deposits 5 PT (creates the collateral stream)"
STREAM=$(cast call $SABLIER 'nextStreamId()(uint256)' --rpc-url $RPC | awk '{print $1}')
send $DEV_PK $PT 'approve(address,uint256)' $OVRFLO 5000000000000000000
send $DEV_PK $WSTETH 'approve(address,uint256)' $OVRFLO 1000000000000000000
send $DEV_PK $OVRFLO 'deposit(address,uint256,uint256)' $MARKET 5000000000000000000 0
echo "stream id: $STREAM (recipient $(cast call $SABLIER 'getRecipient(uint256)(address)' $STREAM --rpc-url $RPC))"

step "3. BORROW via the ladder: target exceeds 10% depth (partial) -> consciously switch to 11% (covers)"
GROSS=$(cast call $LENDING 'quote(address,uint256,uint16,uint128)(uint256,uint128,uint256,uint256,uint128)' $MARKET $STREAM 1000 0 --rpc-url $RPC | sed -n 1p | awk '{print $1}')
TARGET=$(python3 -c "print(int('$GROSS')*6//10)")
DEPTH10=300000000000000000
echo "grossPrice=$GROSS target=$TARGET depth@10%=$DEPTH10 -> partial at 10%, alternative 11% covers"
NET=$(cast call $LENDING 'quote(address,uint256,uint16,uint128)(uint256,uint128,uint256,uint256,uint128)' $MARKET $STREAM 1100 $TARGET --rpc-url $RPC | sed -n 4p | awk '{print $1}')
MIN_ACCEPT=$(python3 -c "print(int('$NET')*9950//10000)")
echo "quote@11%: net=$NET, minAcceptable (0.5% slippage)=$MIN_ACCEPT"

step "4. LIQUIDITY RACE: hydrate projected id 2, lender withdraws it, stale submit reverts, re-quote succeeds"
IDS='[2]'
PROJECTED=$(cast call $LENDING 'liquidityPositions(uint256)(address,address,uint16,uint128)' 2 --rpc-url $RPC)
echo "projected id 2 before race: $PROJECTED"
send $DEV_PK $SABLIER 'approve(address,uint256)' $LENDING $STREAM
send $LENDER_PK $LENDING 'withdrawLiquidity(uint256)' 2   # the race: position 2 drained between quote and submit
if cast send --rpc-url $RPC --private-key $DEV_PK $LENDING 'createBorrowerLoanPool(uint256[],uint256,uint128,uint128)' '[2]' $STREAM $TARGET $MIN_ACCEPT >/dev/null 2>&1; then
  echo "ERROR: stale submit unexpectedly succeeded"; exit 1
else
  echo "stale submit reverted as expected (liquidity inactive) -> re-quote path"
fi
send $LENDER_PK $WSTETH 'approve(address,uint256)' $LENDING 10000000000000000000
send $LENDER_PK $LENDING 'supplyLiquidity(address,uint16,uint128)' $MARKET 1100 10000000000000000000  # fresh depth (id 3)
NET=$(cast call $LENDING 'quote(address,uint256,uint16,uint128)(uint256,uint128,uint256,uint256,uint128)' $MARKET $STREAM 1100 $TARGET --rpc-url $RPC | sed -n 4p | awk '{print $1}')
MIN_ACCEPT=$(python3 -c "print(int('$NET')*9950//10000)")
send $DEV_PK $LENDING 'createBorrowerLoanPool(uint256[],uint256,uint128,uint128)' '[3]' $STREAM $TARGET $MIN_ACCEPT
echo "re-confirmed borrow succeeded: loan 1 = $(cast call $LENDING 'loans(uint256)(address,uint256,uint128,uint128,uint128,bool)' 1 --rpc-url $RPC | sed -n 3p) obligation"

step "5. ADJUST-RATE: lender moves idle 10% liquidity (id 1) to 12% in one multicall"
IDLE=$(cast call $LENDING 'liquidityPositions(uint256)(address,address,uint16,uint128)' 1 --rpc-url $RPC | sed -n 4p | awk '{print $1}')
send $LENDER_PK $WSTETH 'approve(address,uint256)' $LENDING $IDLE
W=$(cast calldata 'withdrawLiquidity(uint256)' 1)
S=$(cast calldata 'supplyLiquidity(address,uint16,uint128)' $MARKET 1200 $IDLE)
send $LENDER_PK $LENDING 'multicall(bytes[])' "[$W,$S]"
echo "moved $IDLE to 12.00%: new position 4 = $(cast call $LENDING 'liquidityPositions(uint256)(address,address,uint16,uint128)' 4 --rpc-url $RPC | sed -n 3p) bps"

step "6. time-warp 10 days, then claims (lender pool share + borrower stream residual channel)"
cast rpc evm_increaseTime 864000 --rpc-url $RPC >/dev/null
cast rpc evm_mine --rpc-url $RPC >/dev/null
BAL_BEFORE=$(cast call $TOKEN 'balanceOf(address)(uint256)' 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC --rpc-url $RPC | awk '{print $1}')
send $LENDER_PK $LENDING 'claimLoanPoolShare(uint256,uint128)' 1 340282366920938463463374607431768211455
BAL_AFTER=$(cast call $TOKEN 'balanceOf(address)(uint256)' 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC --rpc-url $RPC | awk '{print $1}')
echo "lender pool-share claim paid: $(python3 -c "print(int('$BAL_AFTER')-int('$BAL_BEFORE'))") ovrfloToken (deficit harvested from the loan stream)"

echo
echo "=== WALKTHROUGH COMPLETE — all steps succeeded ==="
