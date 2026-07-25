#!/usr/bin/env bash
# local-ui-scenarios.sh — interactive UI/UX scenario runner for local Anvil fork.
#
# Sets up realistic contract state via cast, then walks you through the UI
# as each persona (P1 Depositor, P2 Borrower, P3 Lender) would experience it.
# The goal is to verify the UI/UX is correct — not to stress-test the protocol.
#
# Prerequisites:
#   1. anvil fork running (npm --prefix web run bootstrap:local)
#   2. deployments/local.json exists (created by seed-local.sh)
#   3. dev server running (or run bootstrap:local which starts it)
#
# Usage:
#   ./script/local-ui-scenarios.sh              # interactive menu
#   ./script/local-ui-scenarios.sh lively        # seed a lively market
#   ./script/local-ui-scenarios.sh p1 p2 p3      # run persona walkthroughs in sequence
#   ./script/local-ui-scenarios.sh list          # list all scenarios
#
# Environment:
#   RPC (default: http://127.0.0.1:8545)

set -euo pipefail

RPC=${RPC:-http://127.0.0.1:8545}
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER_ADDR=$(cast wallet address "$OWNER_PK")
# Anvil #1 — seeded with PT + wstETH by seed-local.sh
DEV_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
DEV_ADDR=$(cast wallet address "$DEV_PK")
# Anvil #2 — seeded with PT + wstETH by seed-local.sh
LENDER_PK=0x5de4b78989770766708d133e5f9f8a3153a9c256b0f65a5f8c66d3c2de7f25ac
LENDER_ADDR=$(cast wallet address "$LENDER_PK")
# Anvil #3 — has ETH but no PT/wstETH (we seed it in lively)
LENDER2_PK=0x7c8522cb19db42cfd581d6c15a277a8e68b8a4e6b15fb8b00c1f1e5e5c6083e8
LENDER2_ADDR=$(cast wallet address "$LENDER2_PK")
# Anvil #4
LENDER3_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8735a56d3eb1e4c1c2e0
LENDER3_ADDR=$(cast wallet address "$LENDER3_PK")

DEPLOY=deployments/local.json
if [ ! -f "$DEPLOY" ]; then
  echo "ERROR: $DEPLOY not found. Run 'npm --prefix web run bootstrap:local' first." >&2
  exit 1
fi

FACTORY=$(jq -r '.factory' "$DEPLOY")
OVRFLO=$(jq -r '.ovrflo' "$DEPLOY")
TOKEN=$(jq -r '.token' "$DEPLOY")
LENDING=$(jq -r '.lending' "$DEPLOY")

# Resolve market + PT via verified contract calls.
PRIMARY_MARKET=$(cast call --rpc-url "$RPC" "$FACTORY" 'approvedMarketAt(address,uint256)(address)' "$OVRFLO" 0 2>/dev/null | awk '{print $1}')
PRIMARY_PT=$(cast call --rpc-url "$RPC" "$OVRFLO" 'series(address)(uint32,uint16,uint256,address,address,address)' "$PRIMARY_MARKET" 2>/dev/null | sed -n '4p' | awk '{print $1}')
# Secondary market (index 1) — used for multi-market strip testing.
SECONDARY_MARKET=$(cast call --rpc-url "$RPC" "$FACTORY" 'approvedMarketAt(address,uint256)(address)' "$OVRFLO" 1 2>/dev/null | awk '{print $1}' || echo "")
SECONDARY_PT=$(cast call --rpc-url "$RPC" "$OVRFLO" 'series(address)(uint32,uint16,uint256,address,address,address)' "$SECONDARY_MARKET" 2>/dev/null | sed -n '4p' | awk '{print $1}' || echo "")
# Sablier V2 Lockup Linear on mainnet (verified in web/lib/config.ts).
SABLIER=0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9
WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0

# ─── helpers ──────────────────────────────────────────────────────────────────

send() { cast send --rpc-url "$RPC" --private-key "$1" --legacy "${@:2}" 2>&1; }
call() { cast call --rpc-url "$RPC" "$@"; }

approve_token() {
  local token=$1 pk=$2 spender=$3 amount=$4
  send "$pk" "$token" 'approve(address,uint256)' "$spender" "$amount" >/dev/null
}

# Deposit PT and capture the Sablier stream ID from the Deposited event.
# The event has 2 indexed params (user, market) + 4 non-indexed data words:
# ptAmount, toUser, toStream, streamId. streamId is the 4th word (offset 96 bytes).
deposit_and_get_stream() {
  local pk=$1 amount=$2
  local tx_hash
  tx_hash=$(cast send --rpc-url "$RPC" --private-key "$pk" --legacy --json \
    "$OVRFLO" 'deposit(address,uint256,uint256)' "$PRIMARY_MARKET" "$amount" 0 \
    2>/dev/null | jq -r '.transactionHash // empty' 2>/dev/null || echo "")
  if [ -z "$tx_hash" ]; then
    echo ""
    return
  fi
  # Parse the Deposited event from the receipt.
  # Event sig: Deposited(address,address,uint256,uint256,uint256,uint256)
  local topic
  topic=$(cast keccak "Deposited(address,address,uint256,uint256,uint256,uint256)" 2>/dev/null || echo "")
  local data
  data=$(cast receipt --rpc-url "$RPC" --json "$tx_hash" 2>/dev/null | \
    jq -r --arg t "$topic" '.logs[] | select(.topics[0] == $t) | .data' 2>/dev/null || echo "")
  if [ -z "$data" ]; then
    echo ""
    return
  fi
  # streamId is the 4th 32-byte word in the data: chars 195-258 (0x prefix + 3*64 + 64)
  local stream_hex
  stream_hex="0x$(echo "$data" | sed 's/0x//' | cut -c 193-256)"
  cast --to-dec "$stream_hex" 2>/dev/null || echo ""
}

# Borrow against a stream at a specific tick. Automates:
# 1. Approve lending contract on the Sablier NFT
# 2. Call gatherLiquidity to find liquidity IDs at the tick
# 3. Call createBorrowerLoanPool with minAcceptable=0 (no slippage guard for testing)
borrow_against_stream() {
  local pk=$1 stream_id=$2 apr=$3 amount=$4 borrower=$5
  if [ -z "$stream_id" ] || [ "$stream_id" = "0" ]; then
    echo "    SKIP: no stream ID"
    return 1
  fi
  # 1. Approve lending contract to transfer the stream NFT
  send "$pk" "$SABLIER" 'approve(address,uint256)' "$LENDING" "$stream_id" >/dev/null 2>&1
  # 2. Gather liquidity IDs at the target tick (exclude borrower's own positions)
  local gather_result
  gather_result=$(call "$LENDING" \
    'gatherLiquidity(address,uint16,uint128,uint256,address)(uint256[],bool)' \
    "$PRIMARY_MARKET" "$apr" "$amount" 1 "$borrower" 2>/dev/null || echo "")
  local ids
  ids=$(echo "$gather_result" | head -1 | sed 's/\[\]//; s/\[//g; s/\]//g; s/,/,/g' | tr -d ' ')
  if [ -z "$ids" ] || [ "$ids" = "false" ] || [ "$ids" = "true" ]; then
    echo "    SKIP: no liquidity at ${apr}bps (gather returned empty)"
    return 1
  fi
  # 3. Submit the borrow
  send "$pk" "$LENDING" \
    'createBorrowerLoanPool(uint256[],uint256,uint128,uint128)' \
    "[$ids]" "$stream_id" "$amount" 0 >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "    OK: borrowed $amount against stream #$stream_id at ${apr}bps"
  else
    echo "    FAIL: createBorrowerLoanPool reverted (stream #$stream_id at ${apr}bps)"
    return 1
  fi
}

supply_liquidity() {
  local pk=$1 apr=$2 amount=$3
  approve_token "$WSTETH" "$pk" "$LENDING" "$amount" >/dev/null 2>&1
  send "$pk" "$LENDING" 'supplyLiquidity(address,uint16,uint128)' "$PRIMARY_MARKET" "$apr" "$amount" >/dev/null 2>&1
}

withdraw_position() {
  send "$1" "$LENDING" 'withdrawLiquidity(uint256)' "$2" >/dev/null 2>&1 || true
}

deposit_pt() {
  local pk=$1 amount=$2
  approve_token "$PRIMARY_PT" "$pk" "$OVRFLO" "$amount" >/dev/null 2>&1
  send "$pk" "$OVRFLO" 'deposit(address,uint256,uint256)' "$PRIMARY_MARKET" "$amount" 0 >/dev/null 2>&1
}

next_id() { call "$LENDING" 'nextLiquidityId()' | awk '{print $1}'; }
apr_min() { call "$LENDING" 'aprMinBps()' | awk '{print $1}'; }
apr_max() { call "$LENDING" 'aprMaxBps()' | awk '{print $1}'; }

wstETH=1000000000000000000 # 1e18
PT_AMT=100000000000000000000 # 100e18

banner() {
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

check() {
  echo
  echo "  ── IN THE BROWSER ──"
  echo "  $1"
  echo
  echo "  Press ENTER when you've verified this..."
  read -r
}

seed_wsteth() {
  # Transfer wstETH from owner to a wallet (owner has ~80 wstETH left after seed-local.sh).
  local to=$1 amount=$2
  send "$OWNER_PK" "$WSTETH" 'transfer(address,uint256)' "$to" "$amount" >/dev/null 2>&1
}

# ─── SETUP ────────────────────────────────────────────────────────────────────

setup_market() {
  banner "SETUP: Prepare market (widen APR bounds to 800–1200)"
  echo "  Factory: $FACTORY"
  echo "  Lending: $LENDING"
  echo "  Market:  $PRIMARY_MARKET"
  echo "  Current: aprMinBps=$(apr_min) aprMaxBps=$(apr_max)"
  if [ "$(apr_min)" = "800" ]; then
    echo "  Already widened. Skipping."
  else
    send "$OWNER_PK" "$FACTORY" 'setLendingAprBounds(address,uint16,uint16)' "$LENDING" 800 1200 >/dev/null
    echo "  Done. Now: aprMinBps=$(apr_min) aprMaxBps=$(apr_max)"
    echo "  Ticks available: 8%, 9%, 10%, 11%, 12%"
  fi
}

seed_lively() {
  banner "SEED: Lively market (rich multi-tick + multi-stream + multi-loan + claimable)"
  echo "  Creates a realistic active market for UI walkthroughs."
  echo "  9-phase setup: liquidity → streams → borrows → wrap → time advance → more."
  echo

  # ── Phase 1: Setup ──────────────────────────────────────────────────────
  setup_market

  echo "  [1/9] Seeding extra lender wallets with wstETH..."
  seed_wsteth "$LENDER2_ADDR" "$(python3 -c 'print(30 * 10**18)')" 2>/dev/null || true
  seed_wsteth "$LENDER3_ADDR" "$(python3 -c 'print(21 * 10**18)')" 2>/dev/null || true
  echo "        lender2 ($LENDER2_ADDR): 30 wstETH"
  echo "        lender3 ($LENDER3_ADDR): 21 wstETH"

  # ── Phase 2: Supply liquidity: 3 lenders × 5 ticks = 10 positions ───────
  echo "  [2/9] Supplying liquidity: 10 positions across 5 ticks..."
  # 8% tick: 40 wstETH from 2 lenders (deepest)
  supply_liquidity "$LENDER_PK"  800 "$(python3 -c 'print(25 * 10**18)')"
  supply_liquidity "$LENDER2_PK" 800 "$(python3 -c 'print(15 * 10**18)')"
  # 9% tick: 25 wstETH from 2 lenders
  supply_liquidity "$LENDER_PK"  900 "$(python3 -c 'print(15 * 10**18)')"
  supply_liquidity "$LENDER3_PK" 900 "$(python3 -c 'print(10 * 10**18)')"
  # 10% tick: 40 wstETH from 2 lenders
  supply_liquidity "$LENDER2_PK" 1000 "$(python3 -c 'print(30 * 10**18)')"
  supply_liquidity "$LENDER_PK"  1000 "$(python3 -c 'print(10 * 10**18)')"
  # 11% tick: 13 wstETH from 2 lenders
  supply_liquidity "$LENDER3_PK" 1100 "$(python3 -c 'print(8 * 10**18)')"
  supply_liquidity "$LENDER2_PK" 1100 "$(python3 -c 'print(5 * 10**18)')"
  # 12% tick: 3 wstETH from 1 lender (shallowest — tests depth bar scale)
  supply_liquidity "$LENDER3_PK" 1200 "$(python3 -c 'print(3 * 10**18)')"
  echo "        8%: 40 wstETH (2 positions) ← deepest"
  echo "        9%: 25 wstETH (2 positions)"
  echo "        10%: 40 wstETH (2 positions)"
  echo "        11%: 13 wstETH (2 positions)"
  echo "        12%: 3 wstETH (1 position) ← shallowest"

  # ── Phase 3: Deposit PT → 4 Sablier streams ─────────────────────────────
  echo "  [3/9] Depositing PT: 4 streams from dev wallet..."
  local stream_ids=()
  local sid
  for i in 1 2 3 4; do
    sid=$(deposit_and_get_stream "$DEV_PK" "$PT_AMT")
    stream_ids+=("$sid")
    if [ -n "$sid" ] && [ "$sid" != "0" ]; then
      echo "        Stream #$i: 100 PT → Sablier ID $sid"
    else
      echo "        Stream #$i: 100 PT deposited (ID capture failed — find in browser)"
    fi
  done

  # ── Phase 4: Borrow against 3 of 4 streams (automated via cast) ────────
  echo "  [4/9] Borrowing against 3 streams (automated)..."
  borrow_against_stream "$DEV_PK" "${stream_ids[0]}" 800 \
    "$(python3 -c 'print(20 * 10**18)')" "$DEV_ADDR" || true
  borrow_against_stream "$DEV_PK" "${stream_ids[1]}" 900 \
    "$(python3 -c 'print(15 * 10**18)')" "$DEV_ADDR" || true
  borrow_against_stream "$DEV_PK" "${stream_ids[2]}" 1000 \
    "$(python3 -c 'print(25 * 10**18)')" "$DEV_ADDR" || true
  echo "        3 loans created at 8%, 9%, 10%. Stream 4 unpledged (shows teaser)."

  # Fallback: if automated borrows failed, ask user to do them in browser
  local loan_count
  loan_count=$(call "$LENDING" 'nextLoanId()' 2>/dev/null | awk '{print $1}' || echo "1")
  if [ -z "$loan_count" ] || [ "$loan_count" -le 1 ]; then
    echo
    echo "        NOTE: Automated borrows may have failed (stream ID capture)."
    echo "        Do 3 borrows in the browser:"
    echo "          1. Connect dev wallet ($DEV_ADDR)"
    echo "          2. Expand market → BORROW → select stream → 20 at 8%"
    echo "          3. Repeat: another stream → 15 at 9%"
    echo "          4. Repeat: another stream → 25 at 10%"
    echo "        Press ENTER when done (or skip if automated borrows worked)..."
    read -r
  fi

  # ── Phase 5: Wrap underlying → ovrfloToken (enables UNWRAP) ────────────
  echo "  [5/9] Wrapping 10 wstETH → ovrfloToken (creates wrap reserve)..."
  send "$DEV_PK" "$OVRFLO" 'wrap(uint256)' "$(python3 -c 'print(10 * 10**18)')" >/dev/null 2>&1 || true
  echo "        Wrap reserve: 10 wstETH. UNWRAP enabled. Dev has ovrfloToken from wrap + deposit."

  # ── Phase 6: Advance time +60 days (vesting, self-repayment) ───────────
  echo "  [6/9] Advancing time +60 days..."
  cast rpc --rpc-url "$RPC" anvil_mine 1 $((60 * 24 * 3600)) 2>/dev/null || true
  echo "        Streams at ~18-20% progress. Claimable nonzero. Loans self-repaying."

  # ── Phase 7: Deposit 1 more PT → 5th stream (new, ~0% progress) ───────
  echo "  [7/9] Depositing 80 PT → 5th stream (new, contrasts with older streams)..."
  local new_sid
  new_sid=$(deposit_and_get_stream "$DEV_PK" "$(python3 -c 'print(80 * 10**18)')")
  if [ -n "$new_sid" ] && [ "$new_sid" != "0" ]; then
    echo "        Stream #5: 80 PT → Sablier ID $new_sid"
    echo "        Borrowing 10 wstETH against stream #5 at 8%..."
    borrow_against_stream "$DEV_PK" "$new_sid" 800 \
      "$(python3 -c 'print(10 * 10**18)')" "$DEV_ADDR" || true
    echo "        4th loan (just started, 0% obligation)."
  else
    echo "        Stream #5 created (ID capture failed — visible in browser)"
  fi

  # ── Phase 8: Advance time +30 more days (total +90 days) ───────────────
  echo "  [8/9] Advancing time +30 more days (total +90 from start)..."
  cast rpc --rpc-url "$RPC" anvil_mine 1 $((30 * 24 * 3600)) 2>/dev/null || true
  echo "        Old streams: ~27-30% progress. New stream: ~8%."
  echo "        Old loans: significant obligation progress. New loan: just starting."
  echo "        Claimable amounts substantial — CLAIM ALL enabled."

  # ── Phase 9: Secondary market activity ─────────────────────────────────
  if [ -n "$SECONDARY_MARKET" ] && [ -n "$SECONDARY_PT" ]; then
    echo "  [9/9] Seeding secondary market (1 supply + 1 deposit)..."
    # Supply liquidity to secondary market (supply_liquidity hardcodes PRIMARY_MARKET, so inline here)
    approve_token "$WSTETH" "$LENDER_PK" "$LENDING" "$(python3 -c 'print(10 * 10**18)')" >/dev/null 2>&1
    send "$LENDER_PK" "$LENDING" 'supplyLiquidity(address,uint16,uint128)' \
      "$SECONDARY_MARKET" 1000 "$(python3 -c 'print(10 * 10**18)')" >/dev/null 2>&1 || true
    # Deposit PT into secondary market
    approve_token "$SECONDARY_PT" "$DEV_PK" "$OVRFLO" "$(python3 -c 'print(50 * 10**18)')" >/dev/null 2>&1
    send "$DEV_PK" "$OVRFLO" 'deposit(address,uint256,uint256)' "$SECONDARY_MARKET" \
      "$(python3 -c 'print(50 * 10**18)')" 0 >/dev/null 2>&1 || true
    echo "        Secondary: 10 wstETH supplied at 10%, 50 PT deposited."
  else
    echo "  [9/9] Secondary market not available — skipping."
  fi

  # ── Summary ────────────────────────────────────────────────────────────
  echo
  echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Lively market ready. Refresh the browser. The UI now shows:"
  echo
  echo "  MARKETS TABLE (S0):"
  echo "    • 2 market rows (primary + secondary), both with TVL and RATES"
  echo "    • Primary RATES: 5-tick range with depth"
  echo
  echo "  SUMMARY STRIP (as dev wallet):"
  echo "    • STREAMS: 2 unpledged (3 pledged, 5th is new at ~8% progress)"
  echo "    • SUPPLIED: 0 (dev hasn't supplied — switch to lender to see)"
  echo "    • LOANS: 4 (varying obligation progress, self-repaying)"
  echo "    • CLAIMABLE: nonzero (stream vesting + pool proceeds)"
  echo "    • CLAIM ALL: ENABLED"
  echo
  echo "  EXPANDED ROW — primary market:"
  echo "    • 5-tick ladder (8% deepest, 12% shallowest, depth bars vary)"
  echo "    • Stream cards: 2 unpledged (~30% and ~8% progress) + borrow teasers"
  echo "    • Loan cards: 4 (varying obligation progress — self-repaying)"
  echo "    • Lender positions: switch to lender/lender2/lender3 to see 10 positions"
  echo "    • Pool claim-share cards: claimable proceeds from borrows"
  echo "    • DEMAND column (SUPPLY mode): bars at 8%, 9%, 10% (3-4 borrows)"
  echo "    • Balances: wstETH, PT, ovrfloToken all nonzero"
  echo "    • UNWRAP enabled (wrap reserve: 10 wstETH)"
  echo "    • ADVANCED disclosure: WRAP available"
  echo
  echo "  SWITCH WALLETS to see different persona views:"
  echo "    • Dev ($DEV_ADDR):     depositor + borrower (streams, loans, claim)"
  echo "    • Lender ($LENDER_ADDR): 10 supply positions across 4 ticks"
  echo "    • Lender2 ($LENDER2_ADDR): 5 supply positions across 3 ticks"
  echo "    • Lender3 ($LENDER3_ADDR): 3 supply positions across 3 ticks"
  echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

do_reset() {
  banner "RESET: Re-seed from scratch"
  echo "  This wipes all positions, loans, streams, and liquidity."
  echo "  Run: npm --prefix web run bootstrap:local:clean"
  echo "  Then: npm --prefix web run bootstrap:local"
  echo "  Then: ./script/local-ui-scenarios.sh setup"
  echo
  echo "  Press ENTER when done re-seeding..."
  read -r
  # Re-read deployment addresses
  FACTORY=$(jq -r '.factory' "$DEPLOY")
  OVRFLO=$(jq -r '.ovrflo' "$DEPLOY")
  TOKEN=$(jq -r '.token' "$DEPLOY")
  LENDING=$(jq -r '.lending' "$DEPLOY")
  PRIMARY_MARKET=$(cast call --rpc-url "$RPC" "$FACTORY" 'approvedMarketAt(address,uint256)(address)' "$OVRFLO" 0 2>/dev/null | awk '{print $1}')
  PRIMARY_PT=$(cast call --rpc-url "$RPC" "$OVRFLO" 'series(address)(uint32,uint16,uint256,address,address,address)' "$PRIMARY_MARKET" 2>/dev/null | sed -n '4p' | awk '{print $1}')
  echo "  New deployment: factory=$FACTORY lending=$LENDING"
}

# ─── PERSONA WALKTHROUGHS ─────────────────────────────────────────────────────

p1_deposit() {
  banner "P1 DEPOSITOR: Deposit PT → see stream → claim"
  echo "  Persona: has PT, wants amplified fixed yield."
  echo "  Journey: AWARE → ACT (deposit) → LIVE (stream fills, claim)"
  echo
  echo "  Connect the DEV wallet ($DEV_ADDR) in your browser extension."
  echo "  This wallet has 1000 PT seeded by seed-local.sh."
  echo
  echo "  ── WALKTHROUGH ──"
  echo
  echo "  1. See the markets table (S0):"
  echo "     • Two markets listed (primary + secondary)"
  echo "     • Columns: ASSET, MATURITY, TVL, RATES"
  echo "     • If lively market is seeded: RATES shows tick range (e.g. '8-12% APR')"
  echo
  echo "  2. Expand the primary market row:"
  echo "     • Balances block: wstETH, PT, ovrfloToken balances"
  echo "     • Mode buttons: SUPPLY (gold), BORROW (cyan), DEPOSIT PT (gold)"
  echo
  echo "  3. Click DEPOSIT PT (S3):"
  echo "     • Overlay opens, titled with the market"
  echo "     • Amount input with balance shown"
  echo "     • Deposit cap displayed ('DEPOSIT CAP: NONE' when 0 = unlimited)"
  echo "     • Consequence copy: 'receive X oWSTETH + stream of ~Y wstETH over Nd'"
  echo
  echo "  4. Enter 50 PT, click APPROVE:"
  echo "     • Step indicator: [1] APPROVE (active) → [2] SIGN → [3] CONFIRMED"
  echo "     • Confirm in wallet. APPROVE turns done."
  echo
  echo "  5. Click DEPOSIT:"
  echo "     • SIGN step activates. Confirm in wallet."
  echo "     • CONFIRMED appears. CLOSE button shows."
  echo
  echo "  6. Close overlay, refresh the expanded row:"
  echo "     • New stream card appears (S4): progress bar at ~0%, CLAIMABLE NOW: 0"
  echo "     • REMAINING: ~Y wstETH · ENDS <date>"
  echo "     • Borrow teaser: '⚡ BORROW ~<upfront %>% UPFRONT' (if liquidity exists)"
  echo "     • ovrfloToken balance increased (1:1 with deposited PT)"
  echo
  echo "  7. Advance time (run 'advance' scenario or use anvil_mine), then refresh:"
  echo "     • Stream progress bar has advanced"
  echo "     • CLAIMABLE NOW shows nonzero amount"
  echo "     • Click CLAIM → amount lands in wallet"
  echo
  check "Verify: deposit flow works, stream card renders with progress bar and borrow teaser, claim works after vesting."
}

p1_exit() {
  banner "P1 DEPOSITOR EXIT: Post-maturity claim PT + unwrap"
  echo "  Persona: market has matured, wants to exit ovrfloTokens."
  echo "  Journey: EXIT (burn ovrfloTokens for PT, or unwrap to underlying)"
  echo
  echo "  This requires advancing time past the market expiry."
  echo "  Run the 'mature' scenario first to fast-forward time."
  echo
  echo "  ── WALKTHROUGH ──"
  echo
  echo "  1. Expand the matured market row:"
  echo "     • BORROW and SUPPLY buttons disabled with 'MARKET MATURED' caption"
  echo "     • DEPOSIT PT button hidden"
  echo "     • ovrfloToken row: [CLAIM PT] visible (post-maturity)"
  echo "     • [UNWRAP] visible (if wrap reserve has funds)"
  echo
  echo "  2. Click CLAIM PT:"
  echo "     • Overlay opens in claim_matured mode"
  echo "     • Shows amount of PT claimable"
  echo "     • Submit → PT lands in wallet"
  echo
  echo "  3. Click UNWRAP (if available):"
  echo "     • Overlay opens in unwrap mode"
  echo "     • Shows wrap reserve amount"
  echo "     • Submit → underlying (wstETH) lands in wallet"
  echo
  echo "  4. Open ADVANCED disclosure:"
  echo "     • WRAP button visible (underlying → ovrfloToken)"
  echo
  check "Verify: post-maturity UI shows CLAIM PT + UNWRAP, BORROW/SUPPLY disabled with caption, DEPOSIT hidden."
}

p2_borrow() {
  banner "P2 BORROWER: Ladder → compare ticks → conscious switch → borrow"
  echo "  Persona: has a stream, needs upfront capital."
  echo "  Journey: AWARE → DECIDE (ladder) → ACT (pledge) → LIVE (loan card)"
  echo
  echo "  Requires: lively market seeded (run 'lively') + at least 1 stream (run 'p1' or deposit PT)."
  echo "  Connect the DEV wallet ($DEV_ADDR)."
  echo
  echo "  ── WALKTHROUGH ──"
  echo
  echo "  1. Expand the primary market row → see stream cards"
  echo "  2. Click BORROW mode button (cyan)"
  echo
  echo "  3. BORROW mode opens (S1):"
  echo "     • Stream selector: your stream pre-selected (or pick one)"
  echo "     • APR ladder: 5 rows (8% BEST, 9%, 10%, 11%, 12%)"
  echo "     • Each row: upfront % (borrower lens), tick APR, available liquidity, depth bar"
  echo "     • 8% marked '← BEST' and selected by default"
  echo "     • Quote panel: 'YOU RECEIVE NOW: \$X (91.2%)'"
  echo "     • 'STREAM REPAYS: \$Y over Nd'"
  echo "     • 'RESIDUAL RETURNS TO YOU WHEN OBLIGATION MET'"
  echo "     • Submit button: 'GET \$X NOW'"
  echo "     • Slippage tolerance: '0.5%' (editable)"
  echo
  echo "  4. Click different ticks on the ladder:"
  echo "     • Quote panel updates to show that tick's upfront % and amount"
  echo "     • Higher APR = more cash now but bigger obligation"
  echo "     • Depth bars show relative liquidity at each tick"
  echo
  echo "  5. CONSCIOUS TICK SWITCHING:"
  echo "     • Enter an amount exceeding the 8% tick's remaining liquidity"
  echo "     • Quote panel shows: 'GET \$X AT 8% — PARTIAL FILL'"
  echo "     • Below: 'AMOUNT EXCEEDS LIQUIDITY AT 8%. SEE OPTIONS AT OTHER TICKS?'"
  echo "     • The 9%/10% alternatives are NOT visible yet"
  echo "     • Click 'SHOW OTHER TICKS' → alternative cards appear"
  echo "     • Each card: 'GET \$Y AT 10% — FULL' labeled 'MOST CASH NOW' or 'LOWEST RATE'"
  echo "     • Click a card → ladder updates to that tick, quote panel refreshes"
  echo
  echo "  6. Adjust slippage to '1.0%' — verify the quote updates"
  echo
  echo "  7. Submit 'GET \$X NOW':"
  echo "     • Step indicator: [1] APPROVE → [2] SIGN → [3] CONFIRMED"
  echo "     • After confirmation: receipt shows actual received amount"
  echo "     • If partial fill: 'PARTIAL FILL — RECEIVED \$actual OF \$quoted'"
  echo
  echo "  8. Close overlay, refresh expanded row:"
  echo "     • Stream card disappears (NFT pledged to lending contract)"
  echo "     • New loan card appears (S5): 'LOAN #id · BACKED BY STREAM #id · @ 8%'"
  echo "     • Obligation progress bar at 0%"
  echo "     • 'SELF-REPAYING FROM THE STREAM — NOTHING TO DO.'"
  echo
  check "Verify: ladder renders with both lenses, conscious tick switching gates alternatives behind a click, slippage is editable, borrow creates a loan card, stream disappears."
}

p2_race() {
  banner "P2 BORROWER FAILURE: Liquidity race → re-quote banner"
  echo "  Persona: quoted a borrow, but liquidity moved before tx mined."
  echo "  Journey: ACT → failure branch (revert → re-quote → re-confirm)"
  echo
  echo "  Requires: lively market + a stream. Connect DEV wallet."
  echo
  echo "  ── WALKTHROUGH ──"
  echo
  echo "  1. Open BORROW mode, select a stream"
  echo "  2. Enter an amount at the 8% tick (within its liquidity)"
  echo "  3. Do NOT submit yet. In a terminal, drain the 8% liquidity:"
  echo
  local id=$(next_id); id=$((id - 1))
  echo "     # Find the position ID at 8% tick (check browser or query):"
  echo "     cast send --rpc-url $RPC --private-key $LENDER_PK --legacy \\"
  echo "       $LENDING 'withdrawLiquidity(uint256)' <POSITION_ID>"
  echo
  echo "  4. Now submit the borrow in the browser"
  echo "  5. The tx should revert (stale batch or slippage)"
  echo
  echo "  6. EXPECT: re-quote banner appears:"
  echo "     • 'LIQUIDITY CHANGED — NEW QUOTE:'"
  echo "     • Fresh numbers from the re-run router"
  echo "     • Single RE-CONFIRM button"
  echo "     • No dead-end error, no manual refresh needed"
  echo
  echo "  7. Click RE-CONFIRM → new tx at the fresh tick/amount"
  echo
  echo "  8. NON-RACE REVERT (terminal error):"
  echo "     • Supply liquidity from DEV wallet, then try to borrow against own position"
  echo "     • Expect: 'OVRFLOLending: self-match' → terminal error, NO RE-CONFIRM"
  echo
  check "Verify: race revert → re-quote banner with fresh numbers + RE-CONFIRM. Non-race revert → terminal error, no RE-CONFIRM."
}

p3_supply() {
  banner "P3 LENDER: Demand → supply → position card → adjust rate → claim share"
  echo "  Persona: has underlying, wants fixed return."
  echo "  Journey: AWARE → ACT (supply) → WAIT (demand) → LIVE (consumed) → EXIT (claim)"
  echo
  echo "  Requires: lively market seeded. Connect LENDER wallet ($LENDER_ADDR)."
  echo
  echo "  ── WALKTHROUGH ──"
  echo
  echo "  1. Expand the primary market row"
  echo "  2. Click SUPPLY mode button (gold)"
  echo
  echo "  3. SUPPLY mode opens (S2):"
  echo "     • Lender-lens ladder: tick APR, 'YOU EARN +X% FIXED (Yd)'"
  echo "     • LIQUIDITY WAITING column (total at each tick, including self)"
  echo "     • DEMAND column: bars showing trailing 30d borrow volume per tick"
  echo "     • If lively market: demand bars at 8% and 9% (from the 2 borrows)"
  echo "     • Amount input + tick dropdown (defaulting to lowest tick)"
  echo "     • Consequence copy: 'Earns X% APR as streams are borrowed against it'"
  echo
  echo "  4. Select 10% tick, enter 5 wstETH"
  echo "  5. Click APPROVE → confirm → click SUPPLY → confirm"
  echo "  6. Close overlay, refresh expanded row:"
  echo "     • New lender position card (S6): 'SUPPLY #id @ 10%'"
  echo "     • 'IDLE <amount> [WITHDRAW]'"
  echo "     • 'ADJUST RATE' button"
  echo
  echo "  7. ADJUST RATE:"
  echo "     • Click ADJUST RATE on a position"
  echo "     • Select new tick (e.g. 9% for more competitive pricing)"
  echo "     • Summary: 'MOVE <idle> FROM 10% TO 9%'"
  echo "     • Submit (approve if needed) → multicall in one tx"
  echo "     • Position's tick updates in the card without reload"
  echo
  echo "  8. CLAIM SHARE (if loans exist consuming your liquidity):"
  echo "     • Pool claim-share card shows: aprBps, contribution, claimable"
  echo "     • Click CLAIM → ovrfloToken proceeds land"
  echo
  check "Verify: lender ladder shows both lenses + demand bars, supply creates position card, adjust rate moves tick in one tx, claim share works."
}

# ─── EDGE STATES ──────────────────────────────────────────────────────────────

edge_empty() {
  banner "EDGE: Empty ladder (no liquidity in market)"
  echo "  Withdraws ALL liquidity positions, leaving the market empty."
  echo "  Tests the 'NO LIQUIDITY YET — BE THE FIRST LENDER' empty state."
  echo
  local nid=$(next_id)
  echo "  Withdrawing positions 1 to $((nid - 1))..."
  for id in $(seq 1 $((nid - 1))); do
    withdraw_position "$LENDER_PK" "$id"
    withdraw_position "$LENDER2_PK" "$id"
    withdraw_position "$LENDER3_PK" "$id"
    printf "\r  %d/%d..." "$id" $((nid - 1))
  done
  echo
  echo "  Done. All liquidity withdrawn."
  check "BORROW mode: 'NO LIQUIDITY YET — BE THE FIRST LENDER' + SUPPLY INSTEAD button. SUPPLY mode: DEMAND bars may show prior borrows ('NO LOANS 30D' if none). RATES column in table: '—'."
}

edge_mature() {
  banner "EDGE: Post-maturity market"
  echo "  Advances time past the primary market's expiry."
  local current_ts=$(cast block latest --field timestamp --rpc-url "$RPC")
  local expiry=$(call "$OVRFLO" 'series(address)' "$PRIMARY_MARKET" 2>/dev/null | sed -n '3p' | awk '{print $1}')
  local target=$((expiry + 3600)) # 1h past
  local delta=$((target - current_ts))
  if [ "$delta" -le 0 ]; then
    echo "  Already past expiry (ts=$current_ts, expiry=$expiry)."
  else
    echo "  Expiry: $expiry. Current: $current_ts. Jumping ${delta}s forward..."
    cast rpc --rpc-url "$RPC" anvil_mine 1 "$delta" 2>/dev/null || true
    echo "  New ts: $(cast block latest --field timestamp --rpc-url "$RPC")"
  fi
  check "Expand market: BORROW/SUPPLY disabled 'MARKET MATURED'. DEPOSIT PT hidden. CLAIM PT visible. UNWRAP visible. Stream CLAIM + pool CLAIM SHARE still live."
}

edge_deposit_cap() {
  banner "EDGE: Deposit cap enforcement"
  echo "  Sets a deposit limit on the primary market, then tests the UI."
  echo "  Factory.setMarketDepositLimit(ovrflo, market, limit) — called by owner."
  local current_deposited=$(call "$OVRFLO" 'marketTotalDeposited(address)' "$PRIMARY_MARKET" | awk '{print $1}')
  echo "  Current marketTotalDeposited: $current_deposited"
  # Set cap to current + 5 PT (just above current, so a 10 PT deposit would exceed)
  local cap=$((current_deposited + 5 * 10**18))
  echo "  Setting deposit cap to $cap (current + 5 PT)..."
  send "$OWNER_PK" "$FACTORY" 'setMarketDepositLimit(address,address,uint256)' "$OVRFLO" "$PRIMARY_MARKET" "$cap" >/dev/null 2>&1
  echo "  Done. Cap is now 5 PT above current deposits."
  check "DEPOSIT PT mode: cap shown ('DEPOSIT CAP: <amount>'). Entering 10 PT should disable submit with 'DEPOSIT WOULD EXCEED CAP' caption. Entering 3 PT should work."
}

edge_self_match() {
  banner "EDGE: Self-match exclusion"
  echo "  Supplies liquidity from the DEV wallet, then opens BORROW mode as DEV."
  echo "  The router should exclude self-owned positions with a footnote."
  supply_liquidity "$DEV_PK" 1000 "$(python3 -c 'print(5 * 10**18)')"
  echo "  Dev wallet supplied 5 wstETH at 10%."
  check "BORROW mode as DEV: ladder shows 'EXCLUDES YOUR \$5 SUPPLY' footnote. The 10% tick's available liquidity excludes dev's own 5 wstETH. If no other liquidity at 10%, that tick shows reduced or zero depth."
}

edge_wrap_short() {
  banner "EDGE: Wrap reserve empty"
  echo "  Drains the wrap reserve so UNWRAP is disabled."
  local wrapped=$(call "$OVRFLO" 'wrappedUnderlying()' | awk '{print $1}')
  echo "  Current wrappedUnderlying: $wrapped"
  if [ "$wrapped" = "0" ] || [ -z "$wrapped" ]; then
    echo "  Wrap reserve is already empty."
  else
    local token_bal=$(call "$TOKEN" 'balanceOf(address)' "$DEV_ADDR" | awk '{print $1}')
    if [ "$token_bal" -lt "$wrapped" ]; then
      echo "  Dev has $token_bal ovrfloToken. Unwrapping that amount..."
      send "$DEV_PK" "$OVRFLO" 'unwrap(uint256)' "$token_bal" >/dev/null 2>&1
    else
      echo "  Unwrapping $wrapped (full reserve)..."
      send "$DEV_PK" "$OVRFLO" 'unwrap(uint256)' "$wrapped" >/dev/null 2>&1
    fi
    echo "  wrappedUnderlying now: $(call "$OVRFLO" 'wrappedUnderlying()' | awk '{print $1}')"
  fi
  check "Expand market: UNWRAP button disabled with 'WRAP RESERVE EMPTY' caption. ADVANCED disclosure: WRAP button still works (adds to reserve)."
}

edge_truncation() {
  banner "EDGE: Truncation (501+ positions)"
  echo "  Supplies 501 positions at 10% tick, 0.1 wstETH each from lender."
  echo "  This triggers the tooLarge flag (enumeration cap = 500)."
  local amount=100000000000000000 # 0.1 wstETH
  local start=$(next_id)
  approve_token "$WSTETH" "$LENDER_PK" "$LENDING" "$(python3 -c 'print(501 * 10**17)')" >/dev/null 2>&1
  for i in $(seq 1 501); do
    send "$LENDER_PK" "$LENDING" 'supplyLiquidity(address,uint16,uint128)' "$PRIMARY_MARKET" 1000 "$amount" >/dev/null 2>&1 || true
    printf "\r  %d/501..." "$i"
  done
  echo
  echo "  Done. nextLiquidityId=$(next_id) (was $start)."
  check "Expand market → position list: 'SHOWING FIRST 500 — DATA TRUNCATED'. BORROW mode ladder: truncation warning inside. If all 500 are withdrawn: 'SHOWING FIRST 500 — ACTIVE LIQUIDITY MAY EXIST BEYOND SCAN RANGE' (stronger copy)."
}

# ─── UTILITIES ────────────────────────────────────────────────────────────────

advance_time() {
  banner "ADVANCE TIME"
  echo "  Mines a block with a timestamp delta for stream vesting / claimable accrual."
  echo "  Enter days to advance (default 30):"
  printf "  > "
  read -r days
  days=${days:-30}
  local delta=$((days * 24 * 3600))
  local current_ts=$(cast block latest --field timestamp --rpc-url "$RPC")
  echo "  Jumping ${days} days (${delta}s) forward from ts=$current_ts..."
  cast rpc --rpc-url "$RPC" anvil_mine 1 "$delta" 2>/dev/null || true
  echo "  New ts: $(cast block latest --field timestamp --rpc-url "$RPC")"
  echo "  Refresh the browser to see updated stream progress bars and claimable amounts."
}

# ─── MENU ─────────────────────────────────────────────────────────────────────

declare -A SCENARIOS=(
  [setup]="SETUP: Widen APR bounds to 800-1200 (enables multi-tick ladder)"
  [lively]="SEED: Lively market (multi-tick liquidity + streams + loans + claimable)"
  [reset]="RESET: Re-seed from scratch (bootstrap:local:clean + bootstrap:local)"
  [p1]="P1 DEPOSITOR: Deposit PT → stream card → claim"
  [p1-exit]="P1 DEPOSITOR EXIT: Post-maturity claim PT + unwrap"
  [p2]="P2 BORROWER: Ladder → compare ticks → conscious switch → borrow → loan card"
  [p2-race]="P2 BORROWER FAILURE: Liquidity race → re-quote banner"
  [p3]="P3 LENDER: Demand → supply → position card → adjust rate → claim share"
  [empty]="EDGE: Empty ladder (no liquidity, 'BE THE FIRST LENDER')"
  [mature]="EDGE: Post-maturity market (disabled modes, claim paths live)"
  [deposit-cap]="EDGE: Deposit cap enforcement"
  [self-match]="EDGE: Self-match exclusion (own liquidity excluded from ladder)"
  [wrap-short]="EDGE: Wrap reserve empty (UNWRAP disabled)"
  [truncation]="EDGE: 501+ positions (truncation warning)"
  [advance]="UTILITY: Advance time (for stream vesting / claimable accrual)"
)

run() {
  local id=$1
  case "$id" in
    setup)         setup_market ;;
    lively)        seed_lively ;;
    reset)         do_reset ;;
    p1)            p1_deposit ;;
    p1-exit)       p1_exit ;;
    p2)            p2_borrow ;;
    p2-race)       p2_race ;;
    p3)            p3_supply ;;
    empty)         edge_empty ;;
    mature)        edge_mature ;;
    deposit-cap)   edge_deposit_cap ;;
    self-match)    edge_self_match ;;
    wrap-short)    edge_wrap_short ;;
    truncation)    edge_truncation ;;
    advance)       advance_time ;;
    *) echo "ERROR: unknown scenario '$id'" >&2; return 1 ;;
  esac
}

list_scenarios() {
  echo "Available UI/UX scenarios:"
  echo
  echo "  SETUP"
  echo "    setup        Widen APR bounds to 800-1200 (enables multi-tick ladder)"
  echo "    lively       Seed lively market (multi-tick liquidity + streams + loans + claimable)"
  echo "    reset        Re-seed from scratch"
  echo
  echo "  PERSONA WALKTHROUGHS"
  echo "    p1           P1 Depositor: deposit PT → stream card → claim"
  echo "    p1-exit      P1 Depositor Exit: post-maturity claim PT + unwrap"
  echo "    p2           P2 Borrower: ladder → compare ticks → conscious switch → borrow"
  echo "    p2-race      P2 Borrower Failure: liquidity race → re-quote banner"
  echo "    p3           P3 Lender: demand → supply → position → adjust rate → claim share"
  echo
  echo "  EDGE STATES"
  echo "    empty        Empty ladder (no liquidity, 'BE THE FIRST LENDER')"
  echo "    mature       Post-maturity market (disabled modes, claim paths live)"
  echo "    deposit-cap  Deposit cap enforcement"
  echo "    self-match   Self-match exclusion (own liquidity excluded from ladder)"
  echo "    wrap-short   Wrap reserve empty (UNWRAP disabled)"
  echo "    truncation   501+ positions (truncation warning)"
  echo
  echo "  UTILITIES"
  echo "    advance      Advance time (for stream vesting / claimable accrual)"
  echo
  echo "  Usage: ./script/local-ui-scenarios.sh <scenario> [scenario2 ...]"
  echo "         ./script/local-ui-scenarios.sh lively p1 p2 p3"
}

main() {
  if [ $# -gt 0 ]; then
    if [ "$1" = "list" ]; then list_scenarios; exit 0; fi
    for id in "$@"; do run "$id" || echo "  (scenario '$id' failed, continuing...)"; done
    exit 0
  fi

  # Interactive menu
  while true; do
    banner "OVRFLO Local UI/UX Scenario Runner"
    echo "  Factory: $FACTORY"
    echo "  Lending: $LENDING"
    echo "  Market:  $PRIMARY_MARKET"
    echo "  Lender:  $LENDER_ADDR"
    echo "  Dev:     $DEV_ADDR"
    echo "  aprMin:  $(apr_min)  aprMax: $(apr_max)"
    echo "  nextId:  $(next_id)"
    list_scenarios
    echo
    echo "  Enter scenario name(s), or 'quit':"
    printf "  > "
    read -r input
    [ "$input" = "quit" ] || [ "$input" = "q" ] || [ -z "$input" ] && break
    for id in $input; do run "$id" || echo "  (scenario '$id' failed...)"; done
  done
  echo "  Bye."
}

main "$@"
