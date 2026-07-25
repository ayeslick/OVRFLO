---
title: "Devnet Testing Plan — Tenderly VTN Scenario Walkthroughs"
type: test
date: 2026-07-25
topic: devnet-testing
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: manual
---

# Devnet Testing Plan

## Goal Capsule

- **Objective:** Provide a structured manual testing procedure for the OVRFLO web frontend against a Tenderly Virtual Testnet (VTN) deployment, covering scenarios that leverage real block times, real Sablier stream vesting, real Ponder indexer latency, multi-wallet concurrent interaction, and deployment persistence across restarts — things that cannot be tested on a local Anvil fork.
- **Product authority:** `docs/plans/ux-personas-journeys-screens.md` (screens S0–S6, edge states), `docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md` (R1–R33 requirements), `DESIGN.md` (visual compliance).
- **Execution profile:** manual — human-driven walkthroughs against a Tenderly VTN deployment with hosted Ponder.
- **Stop conditions:** All scenario sections completed; indexer latency verified; multi-wallet scenarios passed; persistence verified; Ponder-down degradation verified.
- **Open blockers:** none. Requires `PRIVATE_KEY`, `DEV_WALLET`, `TENDERLY_RPC_URL`, `PONDER_URL`, and `REOWN_PROJECT_ID` env vars.

---

## Product Contract

### Summary

A scenario-driven manual testing procedure for the Tenderly VTN environment. Unlike the local Anvil fork (which uses instant mining and storage manipulation), the devnet exercises realistic block times, real Sablier stream vesting, real Ponder indexer latency, and persistent state across restarts. The procedure focuses on what devnet testing uniquely verifies: indexer lag behavior, confirmation time UX, multi-wallet concurrent interaction, long-running stream vesting, and deployment persistence. Edge cases that require state manipulation (race simulation, maturity fast-forward, storage hacking) remain on the local plan and are explicitly cross-referenced.

### Environment

| Item | Value |
|---|---|
| RPC | `$TENDERLY_RPC_URL` (Tenderly VTN JSON-RPC) |
| Chain ID | 1 (VTN configured as mainnet alias) |
| Ponder SQL | `$PONDER_URL` (hosted Ponder instance indexing the VTN) |
| Deployer | `$PRIVATE_KEY` (pre-funded with ~10 ETH on VTN) |
| Dev wallet | `$DEV_WALLET` (receives PT + wstETH from SeedDevnet) |
| Deployment | `forge script script/SeedDevnet.s.sol --rpc-url $TENDERLY_RPC_URL --broadcast --slow` |
| Env file | `web/.env.devnet` (written by `tools/scripts/write-env.sh devnet`) |

### Key Differences from Local Testing

| Dimension | Local (Anvil fork) | Devnet (Tenderly VTN) |
|---|---|---|
| Block times | Instant (manual mine) | ~1–2s (automatic) |
| Time manipulation | `anvil_mine` / `setBlockTimestampInterval` | Not available |
| Storage manipulation | `anvil_setStorageAt` | Not available |
| APR bound widening | `cast send` from owner EOA | Requires multisig (or pre-configured in SeedDevnet) |
| Ponder | localhost:42069 | Hosted instance (must be deployed separately) |
| Multi-wallet | Switch accounts in one browser | Multiple browsers/devices can connect simultaneously |
| State persistence | Lost on `bootstrap:local:clean` | Persists across restarts (VTN state is durable) |
| Indexer lag | Minimal (local, fast) | Realistic (hosted Ponder, network latency) |
| Confirmation UX | Instant | ~1–2s per tx (realistic) |
| Sablier vesting | Can fast-forward | Real-time only (can't accelerate) |

### Pre-Test Setup

1. **Deploy contracts:** `npm --prefix web run bootstrap:devnet` (runs `forge script SeedDevnet.s.sol --broadcast --slow` against the VTN, writes `web/.env.devnet`). Required env: `PRIVATE_KEY`, `DEV_WALLET`, `TENDERLY_RPC_URL`, `PONDER_URL`.
2. **Verify deployment:** `cat deployments/devnet.json` — confirm factory, ovrflo, token, lending, devWallet addresses.
3. **Host Ponder:** a Ponder instance must be running against the same VTN RPC. This is NOT started by `bootstrap-devnet.sh` — it must be deployed separately (e.g., on a cloud VM or Docker container pointing at `$TENDERLY_RPC_URL`). Verify: `curl -fsS $PONDER_URL/status` returns 200.
4. **Copy env to local:** `cp web/.env.devnet web/.env.local` (the dev server reads `.env.local`).
5. **Set `REOWN_PROJECT_ID`:** ensure `NEXT_PUBLIC_REOWN_PROJECT_ID` is set in `web/.env.local`.
6. **Start dev server:** `npm --prefix web run dev`.
7. **Connect wallet:** configure your wallet extension to use the Tenderly VTN RPC URL. Import the dev wallet private key.
8. **APR bounds:** if SeedDevnet does not widen APR bounds, the ladder will show a single tick (1000 bps). To test multi-tick behavior on devnet, either modify `SeedDevnet.s.sol` to call `setLendingAprBounds(800, 1200)` before seeding, or submit the bound-widening call through the multisig flow (impractical for testing). Document the single-tick limitation if bounds are not widened.

### Key Decisions

- **Devnet complements local, not replaces it.** Scenarios requiring state manipulation (race simulation, maturity fast-forward, truncation warnings via 501 supplies) stay on the local plan. Devnet focuses on what only real block times and real persistence can verify.
- **Ponder hosting is a prerequisite.** Without a hosted Ponder instance, stream discovery and demand indexing are unavailable. The Ponder-down degradation test (kill Ponder) is still possible but requires access to the Ponder host.
- **Multi-wallet is the primary devnet advantage.** Two testers with separate browsers and separate wallets can interact concurrently, exercising real contention and real indexer lag.

---

## Planning Contract

### Requirements

**Setup & Teardown**

- R1. Bootstrap completes: `forge script SeedDevnet.s.sol` succeeds, `deployments/devnet.json` written, `web/.env.devnet` written with correct factory address, RPC URL, and Ponder URL.
- R2. Ponder hosted and reachable: `curl -fsS $PONDER_URL/status` returns 200. Ponder indexes the VTN's `LendingDeployed` and `BorrowerLoanPoolCreated` events.
- R3. Dev server starts with devnet env: `cp web/.env.devnet web/.env.local && npm --prefix web run dev`. App loads, connects to VTN, no console errors.
- R4. Teardown: `npm --prefix web run bootstrap:devnet:clean` cleans up env files. VTN state persists (no contract teardown — VTN can be deleted via Tenderly dashboard if needed).

**Realistic Confirmation UX**

- R5. Every transaction (supply, borrow, claim, adjust-rate, deposit, withdraw, unwrap, wrap) shows the full lifecycle in real time: SIGNING (wallet prompt) → CONFIRMING (tx in mempool, ~1–2s on VTN) → CONFIRMED (receipt mined). The step indicator transitions are visible and smooth.
- R6. Wallet rejection during CONFIRMING: reject a tx after it's submitted but before it's mined. Verify the error state displays and the modal stays open for retry.
- R7. Gas estimation: every tx shows a gas estimate before signing (wallet extension handles this). Verify no tx fails with "out of gas" — the contract functions should have sufficient gas limits from the viem estimation.

**Indexer Lag Behavior**

- R8. After a confirmed supply, the new liquidity position appears in the expanded row's position list within ~5s (Ponder indexing + wagmi refetch). The "REFRESHING…" indicator (dim mono) appears briefly on indexer-backed regions (held-streams list, demand column) between confirmation and refetch, then disappears.
- R9. After a confirmed borrow, the pledged stream disappears from the stream list within ~5s. The borrow teaser on the stream card disappears. If the borrower retries during the lag window, the stale stream may still render — verify the borrow submit reverts with `sablier.transferFrom` (contract-level guard) and the gas cost is shown.
- R10. After a confirmed borrow, the DEMAND column in SUPPLY mode shows a new bar at the borrow's tick within ~5–10s (Ponder indexes `BorrowerLoanPoolCreated`). The bar shows "1 LOAN · \<amount\>".
- R11. Indexer unreachable: if the hosted Ponder goes down, verify: stream cards, BORROW stream selector, and CLAIM STREAM show "STREAM DATA UNAVAILABLE — RETRY" with a manual retry button. Demand column shows "—" with "NO DEMAND DATA". Markets table, balances, and non-stream surfaces remain functional.

**Multi-Wallet Concurrent Interaction**

- R12. **Lender + borrower concurrency:** Tester A (lender wallet) supplies liquidity at 8%. Tester B (borrower wallet, separate browser) opens BORROW mode and sees the 8% liquidity appear (may require a refresh or waiting for wagmi refetch). Tester B borrows against it. Tester A's supply position shows reduced `availableLiquidity` (consumed by the borrow) without reload.
- R13. **Claim contention:** Tester A and Tester B both have claimable pool shares. Tester A claims first. Tester B's claimable amount adjusts (pro-rata from shared `loanPoolProceeds`) without reload. Tester B claims successfully.
- R14. **Race condition (natural):** Tester A quotes a borrow. Tester B (lender) withdraws liquidity in a separate browser. Tester A submits the borrow. Expect the stale-batch revert → R14 re-quote banner (same behavior as local, but triggered by a real concurrent action, not a `cast send` hack).

**Long-Running Stream Vesting**

- R15. **Stream accrual over time:** after depositing PT and receiving a Sablier stream, wait 10+ minutes (or use the VTN's time features if available). Verify the stream card's progress bar advances (streamed fraction increases). Verify "CLAIMABLE NOW \<withdrawable\>" increases. Click CLAIM. Verify the claimed amount lands in the wallet.
- R16. **Loan self-repayment over time:** after a borrow, wait for the stream to vest enough that `_claimFair` can harvest. Verify the loan card's obligation progress bar advances (drawn + repaid increases). The loan moves toward settlement without any borrower action.
- R17. **Claim-all after vesting:** after multiple streams have accrued claimable amounts, click CLAIM ALL. Verify the queue includes all claimable pools and streams. Execute the queue. Verify all amounts land.

**Deployment Persistence**

- R18. **State persists across restart:** stop the dev server. Restart it. Verify all positions, loans, streams, and liquidity are still visible (VTN state is durable). No re-seeding needed.
- R19. **Ponder restart:** stop and restart the hosted Ponder instance. Verify it re-indexes from the start block and catches up. Stream discovery and demand data resume.
- R20. **Fresh wallet connection:** disconnect and reconnect the wallet. Verify the app re-fetches all data and renders correctly. Verify the expanded row state and overlay state are reset (not stale).

**Ponder Demand Pipeline (End-to-End)**

- R21. **Demand populates:** execute several borrows at different ticks over time. Verify the DEMAND column in SUPPLY mode shows bars at each tick with correct loan counts and amounts. The bars are scaled relative to the max tick volume.
- R22. **Demand self-exclusion:** if the connected wallet has created borrows, verify those are excluded from the demand display (self-demand is not signal per R22 of the web UX v1 plan).
- R23. **Demand degradation:** unset `NEXT_PUBLIC_PONDER_URL` and restart the dev server. Verify the DEMAND column shows "—" with "NO DEMAND DATA" caption. The rest of the app works normally.

**Sablier Integration (Real Streams)**

- R24. **Stream creation on deposit:** deposit PT. Verify a real Sablier stream is created (visible in the stream card with correct deposited amount, start time, and end time matching the market's expiry).
- R25. **Stream pledge on borrow:** borrow against a stream. Verify the stream NFT transfers to the lending contract (the stream disappears from the borrower's stream list and appears as "BACKED BY STREAM #id" on the loan card).
- R26. **Stream residual return:** when a loan's obligation is met (stream vests enough + `_claimFair` harvests), verify the residual stream returns to the borrower. The stream reappears in the borrower's stream list with the remaining amount.
- R27. **Withdraw max:** click CLAIM on a stream with `withdrawable > 0`. Verify `sablier.withdrawMax(streamId, user)` executes and the claimed amount lands in the wallet.

### Acceptance Examples

- AE1. **Covers R12.** Given Tester A supplies 10 wstETH at 8%, and Tester B opens BORROW mode in a separate browser, Tester B sees the 8% liquidity within one refetch cycle. Tester B borrows 5 wstETH. Tester A's position shows 5 wstETH `availableLiquidity` (5 consumed) without reload.
- AE2. **Covers R14.** Given Tester A has a borrow quote open, and Tester B withdraws the backing liquidity, Tester A's submit reverts with "LIQUIDITY CHANGED — NEW QUOTE:" banner. This is a real concurrent race, not a simulated one.
- AE3. **Covers R15.** Given a stream has been vesting for 10 minutes, the stream card's progress bar has advanced and "CLAIMABLE NOW" shows a nonzero withdrawable amount. Clicking CLAIM succeeds and the amount lands in the wallet.
- AE4. **Covers R11.** Given the hosted Ponder instance is stopped, stream cards show "STREAM DATA UNAVAILABLE — RETRY" and the markets table remains fully functional.

### Scope Boundaries

**Out of scope (tested locally instead):**

- Race simulation via `cast send` drain (local plan R13 — use natural concurrency on devnet instead, R14).
- Maturity fast-forward via `anvil_mine` (local plan R35 — devnet cannot fast-forward).
- Truncation warning via 501+ supplies (local plan R38 — impractical on devnet due to gas/time).
- APR bound widening (local plan R2 — devnet requires multisig or SeedDevnet modification).
- Visual inspection and responsive testing (local plan U10/U11 — same results on devnet, no need to duplicate).

**Out of scope (not testable on either environment):**

- Production gas costs (VTN gas is simulated).
- Mainnet RPC reliability and rate limits.
- Cross-chain behavior (OVRFLO is mainnet-only).
- Real yield accrual from Pendle PT (requires real mainnet PT holdings post-maturity).

---

## Implementation Units

### U1. Setup and environment preparation

- **Goal:** Deploy to Tenderly VTN, host Ponder, configure the web app, verify connectivity.
- **Requirements:** R1, R2, R3, R4.
- **Steps:**
  1. Set env vars: `export PRIVATE_KEY=... DEV_WALLET=... TENDERLY_RPC_URL=... PONDER_URL=... REOWN_PROJECT_ID=...`
  2. `npm --prefix web run bootstrap:devnet` — wait for forge script completion.
  3. `cat deployments/devnet.json` — record addresses.
  4. Verify Ponder: `curl -fsS $PONDER_URL/status`.
  5. `cp web/.env.devnet web/.env.local`
  6. `npm --prefix web run dev` — wait for ready.
  7. Configure wallet extension with VTN RPC URL. Import dev wallet key.
  8. Navigate to `localhost:3000`. Confirm app loads, markets table renders, wallet connects.
- **Pass criteria:** App loads on VTN. Wallet connects. Markets table shows seeded markets.

### U2. Seed initial state (supply from dev wallet)

- **Goal:** Create liquidity for borrow testing. Since APR bounds may not be widened on devnet, this may be a single-tick (10%) scenario.
- **Requirements:** R5 (confirmation lifecycle).
- **Steps:**
  1. Connect dev wallet. Expand primary market. Click SUPPLY.
  2. Select the available tick (10% if bounds not widened, or 8% if widened).
  3. Enter 10 wstETH. Click APPROVE → confirm in wallet → wait for CONFIRMED (~2s).
  4. Click SUPPLY → confirm in wallet → wait for CONFIRMED (~2s).
  5. Verify position appears in expanded row within ~5s (indexer lag).
- **Pass criteria:** Supply position visible. Confirmation lifecycle observed with realistic ~1–2s delays.

### U3. Full lifecycle walkthrough (deposit → borrow → claim)

- **Goal:** Exercise the complete user journey from deposit through claim on a real Sablier stream.
- **Requirements:** R5, R8, R9, R10, R24, R25, R27.
- **Steps:**
  1. **Deposit PT:** expand primary market, click DEPOSIT PT, enter 100 PT, approve + deposit. Wait for stream to appear (~5s indexer lag).
  2. **Verify stream card:** check progress bar, CLAIMABLE NOW, REMAINING, ENDS date, borrow teaser.
  3. **Borrow:** click BORROW. Select stream. Enter amount within liquidity. Set slippage. Submit. Confirm. Wait for CONFIRMED.
  4. **Verify loan card:** check "LOAN #id · BACKED BY STREAM #streamId · @ aprBps%", obligation progress, "SELF-REPAYING" copy.
  5. **Verify stream pledged:** stream card disappears from stream list (NFT transferred to lending contract).
  6. **Wait for vesting:** wait 10+ minutes. Verify stream card reappears (if residual returns after obligation met) or check loan progress bar advancing.
  7. **Claim:** if claimable > 0, click CLAIM on a stream or CLAIM ALL. Verify amount lands.
- **Pass criteria:** Full lifecycle works end-to-end with real Sablier streams. Indexer lag is visible (~5s) and handled gracefully.

### U4. Multi-wallet concurrent interaction

- **Goal:** Exercise real concurrent interaction between two testers.
- **Requirements:** R12, R13, R14.
- **Steps:**
  1. **Setup:** Tester A (browser 1, lender wallet) supplies liquidity. Tester B (browser 2, borrower wallet) deposits PT to create a stream.
  2. **Concurrent borrow:** Tester B opens BORROW, quotes at the tick where Tester A supplied. Tester B borrows. Tester A's position shows reduced `availableLiquidity` without reload.
  3. **Claim contention:** both testers accrue claimable amounts (from pool shares or stream vesting). Tester A claims. Tester B's claimable adjusts (pro-rata). Tester B claims.
  4. **Natural race:** Tester B opens a borrow quote. Tester A withdraws liquidity in browser 1. Tester B submits. Expect re-quote banner.
- **Pass criteria:** Concurrent actions are reflected across browsers without manual reload. Natural race triggers R14 recovery.

### U5. Indexer lag and Ponder-down verification

- **Goal:** Verify realistic indexer lag behavior and Ponder-down degradation.
- **Requirements:** R8, R9, R10, R11, R23.
- **Steps:**
  1. **Indexer lag (supply):** supply liquidity. Watch for "REFRESHING…" indicator on indexer-backed regions between confirmation and refetch. Verify it disappears when data arrives (~5s).
  2. **Indexer lag (borrow):** borrow against a stream. Verify the stream disappears from the list within ~5s. Verify the borrow teaser disappears.
  3. **Demand populates:** after a borrow, switch to SUPPLY mode. Verify DEMAND column shows a bar at the borrow's tick within ~5–10s.
  4. **Ponder-down:** stop the hosted Ponder instance. Refresh the page. Verify "STREAM DATA UNAVAILABLE — RETRY" on stream surfaces. Verify markets table and balances remain functional. Verify DEMAND column shows "—" with "NO DEMAND DATA".
  5. **Ponder restart:** restart Ponder. Verify it re-indexes from the start block. Stream discovery and demand data resume within ~30s (depending on block range).
- **Pass criteria:** Indexer lag is visible and handled with "REFRESHING…" indicators. Ponder-down degrades gracefully. Ponder restart recovers.

### U6. Deployment persistence

- **Goal:** Verify state persists across restarts.
- **Requirements:** R18, R19, R20.
- **Steps:**
  1. **Dev server restart:** stop `npm --prefix web run dev`. Restart it. Navigate to the app. Verify all positions, loans, streams, and liquidity are still visible.
  2. **Ponder restart:** stop and restart the hosted Ponder. Verify it catches up and data resumes.
  3. **Wallet reconnect:** disconnect wallet. Reconnect. Verify data re-fetches and renders correctly. Verify expanded row and overlay states are reset.
- **Pass criteria:** VTN state persists. Ponder recovers after restart. Wallet reconnect works.

### U7. Sablier integration verification

- **Goal:** Verify real Sablier stream behavior (creation, pledge, residual return, withdraw max).
- **Requirements:** R24, R25, R26, R27.
- **Steps:**
  1. **Stream creation:** deposit PT. Verify stream card shows correct deposited amount, start time, end time (matching market expiry).
  2. **Stream pledge:** borrow against the stream. Verify stream NFT transfers to lending contract (stream disappears from list, appears on loan card as "BACKED BY STREAM #id").
  3. **Residual return:** wait for the loan obligation to be met via stream vesting + `_claimFair` harvests. Verify the residual stream returns to the borrower (stream reappears in stream list with remaining amount).
  4. **Withdraw max:** click CLAIM on a stream with `withdrawable > 0`. Verify `sablier.withdrawMax` executes and amount lands.
- **Pass criteria:** Real Sablier streams work correctly through the full lifecycle (create, pledge, vest, residual return, withdraw).

### U8. Teardown

- **Goal:** Clean up env files and optionally delete the VTN.
- **Requirements:** R4.
- **Steps:**
  1. `npm --prefix web run bootstrap:devnet:clean` — removes `web/.env.devnet`.
  2. Optionally delete the VTN via the Tenderly dashboard if no longer needed.
  3. If keeping the VTN: record `deployments/devnet.json` for future re-use. Re-run `cp web/.env.devnet web/.env.local` to resume testing later.
- **Pass criteria:** Env files cleaned. VTN state documented or deleted.

---

## Verification Contract

| Gate | Method | Applies to |
|---|---|---|
| Scenario completion | Manual walkthrough of U1–U8 | All scenarios |
| Confirmation lifecycle | Observe SIGNING → CONFIRMING → CONFIRMED on every tx | U2, U3, U4 |
| Indexer lag | Verify ~5s delay + "REFRESHING…" indicator | U5 |
| Ponder-down | Stop Ponder, verify degradation, restart, verify recovery | U5 |
| Multi-wallet | Two browsers, concurrent actions, cross-browser refresh | U4 |
| Persistence | Restart dev server + Ponder, verify state | U6 |
| Sablier integration | Full stream lifecycle (create, pledge, vest, return, withdraw) | U7 |

---

## Definition of Done

- All R-IDs (R1 through R27) verified on the Tenderly VTN.
- Realistic confirmation lifecycle observed on every transaction type.
- Indexer lag (~5s) is visible and handled with "REFRESHING…" indicators.
- Ponder-down degradation shows "STREAM DATA UNAVAILABLE — RETRY" on stream surfaces; non-stream surfaces remain functional.
- Multi-wallet concurrent interaction works (two browsers, real contention).
- Natural race condition triggers R14 re-quote banner.
- Demand column populates from real `BorrowerLoanPoolCreated` events.
- Real Sablier streams work through the full lifecycle (create, pledge, vest, residual return, withdraw max).
- State persists across dev server and Ponder restarts.
- Wallet reconnect re-fetches data correctly.
- Env files cleaned on teardown.
