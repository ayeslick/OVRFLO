---
title: "Local Manual Testing Plan — Anvil Fork Scenario Walkthroughs"
type: test
date: 2026-07-25
topic: local-manual-testing
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: manual
---

# Local Manual Testing Plan

## Goal Capsule

- **Objective:** Provide a structured manual testing procedure for the OVRFLO web frontend against a local Anvil mainnet fork, covering every screen (S0–S6), every user journey (deposit, supply, borrow, claim-all, adjust-rate, stream claim, close loan, unwrap, wrap), and every edge state (no liquidity, partial fill, race conditions, matured market, signer switch, wrap reserve empty, truncation warnings, slippage adjustment, conscious tick-switching).
- **Product authority:** `docs/plans/ux-personas-journeys-screens.md` (screens S0–S6, edge states), `docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md` (R1–R33 requirements), `DESIGN.md` (visual compliance).
- **Execution profile:** manual — human-driven walkthroughs against `npm --prefix web run bootstrap:local`.
- **Stop conditions:** All scenario sections completed; all edge cases verified; visual inspection checklist passed; responsive check passed; Ponder-off degradation verified.
- **Open blockers:** none. Requires `MAINNET_RPC_URL` env var and Foundry toolchain.

---

## Product Contract

### Summary

A screen-by-screen manual testing procedure for the local Anvil fork environment, plus a selectable UI/UX scenario catalog (15 scenarios) driven by `script/local-ui-scenarios.sh`. Each scenario sets up realistic contract state via `cast send` (verified against `src/`), then walks the tester through the UI as each persona (P1 Depositor, P2 Borrower, P3 Lender) would experience it, referencing the UX spec's screens (S0–S6) and journey maps. The procedure leverages Anvil's instant mining and storage manipulation for edge cases that are impractical on devnet (time manipulation, instant liquidity draining for race simulation, APR bound widening). Two seeded wallets (dev + lender) plus optionally seeded extra wallets enable multi-role scenarios. Ponder runs locally for stream discovery and demand indexing. The scenario runner supports individual selection (`./script/local-ui-scenarios.sh p2`), sequential execution (`lively p1 p2 p3`), or an interactive menu.

### Environment

| Item | Value |
|---|---|
| RPC | `http://127.0.0.1:8545` |
| Chain ID | 1 (mainnet fork) |
| Fork block | 24609670 |
| Dev wallet | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Anvil #1) |
| Lender wallet | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` (Anvil #2) |
| Owner PK | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Anvil #0) |
| Ponder SQL | `http://localhost:42069/sql` |
| Markets | Primary (expiry 1782345600), Secondary (expiry 1830124800) |
| Seeded assets | 1000 PT + 60 wstETH per wallet |

### Pre-Test Setup

1. **Start the environment:** `npm --prefix web run bootstrap:local` (starts anvil, seeds contracts, starts Ponder, writes `.env.local`, launches dev server). Wait for "ready" in the terminal.
2. **Verify deployment artifact:** `cat deployments/local.json` — confirm factory, ovrflo, token, lending, devWallet, lenderWallet addresses are present.
3. **Widen APR bounds for multi-tick testing** (the seed defaults to `aprMinBps == aprMaxBps == 1000`, a single-tick degenerate case):
   ```bash
   cast send --rpc-url http://127.0.0.1:8545 \
     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
     --legacy <LENDING_ADDRESS> \
     'setLendingAprBounds(uint16,uint16)' 800 1200
   ```
   This sets ticks at 8%, 9%, 10%, 11%, 12% (step 100bps). Replace `<LENDING_ADDRESS>` with the `lending` value from `deployments/local.json`. The local owner is a test EOA, so no multisig is needed.
4. **Set `REOWN_PROJECT_ID`:** if not already in `web/.env.local`, add `NEXT_PUBLIC_REOWN_PROJECT_ID=<your_id>` and restart the dev server. Required for wallet connection.
5. **Import dev wallet into your wallet extension:** use the private key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` (Anvil #1) or connect via the dev wallet address.

### Key Decisions

- **Anvil-specific leverage:** instant mining, `anvil_setStorageAt`, `anvil_mine`, and `cast send` enable edge cases that are impractical or impossible on devnet: draining liquidity between quote and submit (race simulation), fast-forwarding time (maturity boundary), manipulating balances and wrap reserve directly.
- **Two-wallet testing:** the dev wallet (borrower/depositor) and lender wallet (liquidity provider) can be switched in the browser by changing the connected account, enabling multi-party scenarios without a second browser.
- **Ponder is local:** stream discovery and demand indexing run on localhost. Ponder-off testing is as simple as killing the Ponder process.

---

## Planning Contract

### Requirements

**Setup & Teardown**

- R1. Bootstrap completes: anvil fork running, contracts seeded, Ponder indexed, dev server serving, `.env.local` written with correct factory address and Ponder URL.
- R2. APR bounds widened to 800–1200 bps (multi-tick ladder). Verify via `cast call <LENDING> 'params()'` showing `aprMinBps=800, aprMaxBps=1200`.
- R3. Teardown: `npm --prefix web run bootstrap:local:clean` stops anvil and Ponder, removes PID files. Re-bootstrap works after clean.

**S0 — Summary Strip + Markets Table**

- R4. Markets table renders both markets with columns: ASSET, MATURITY (date + "Nd"), TVL, RATES (tick range in both lenses or "—" when no liquidity). No SELECT column.
- R5. Connected with positions: summary strip renders four cells (STREAMS, SUPPLIED, LOANS, CLAIMABLE) with per-symbol amounts. CLAIM ALL button present, disabled when claimable = 0.
- R6. Disconnected: no strip. Connected with zero positions: no strip.
- R7. Clicking a row expands it (accordion); clicking another row collapses the first and expands the second. `aria-expanded` toggles. Expanded detail shows balances, position list, mode buttons.
- R8. Mode buttons: SUPPLY (gold), BORROW (cyan), DEPOSIT PT (gold). Disabled states with dim mono captions: "LENDING NOT DEPLOYED" when `lending === null`, "NO STREAMS AVAILABLE" for BORROW when no eligible stream, "CONNECT WALLET" when disconnected. DEPOSIT PT hidden post-maturity.

**S1 — Borrow Mode**

- R9. BORROW mode opens the overlay with stream selector, APR ladder, and quote panel. Ladder shows ticks with liquidity, each row: upfront %, tick APR, available liquidity (excluding own), depth bar. Lowest-APR tick marked "← BEST" and selected by default.
- R10. Amount defaults to MAX; editing downward updates the quote. Slippage tolerance input visible (default "0.5%", editable). Changing slippage updates `minAcceptable`.
- R11. **Conscious tick-switching:** when amount exceeds selected tick's liquidity, partial-fill quote shows at the selected tick. "SHOW OTHER TICKS" prompt appears. Deeper-tick alternatives are NOT rendered until the borrower clicks "SHOW OTHER TICKS". Clicking renders alternative cards. Selecting an alternative updates the ladder's selected tick.
- R12. Submit: "GET \<amount\> NOW" button. After confirmation, receipt display shows actual received amount. If partial fill, "PARTIAL FILL — RECEIVED \<actual\> OF \<quoted\>" caption appears.
- R13. **Race simulation:** after quoting, drain a liquidity position from the lender wallet via `cast send <LENDING> 'withdrawLiquidity(uint256)' <id>`. Submit the borrow. Expect revert → R14 re-quote banner with "LIQUIDITY CHANGED — NEW QUOTE:" and RE-CONFIRM button.
- R14. **Revert classification:** trigger a non-race revert (e.g., self-match by supplying from the borrower's own wallet then trying to borrow against it). Expect terminal error state with contract revert string and NO RE-CONFIRM button.

**S2 — Supply Mode**

- R15. SUPPLY mode opens the overlay with lender-lens ladder: tick APR, "YOU EARN +X% FIXED (Yd)", LIQUIDITY WAITING, DEMAND column. Amount input, tick select dropdown, consequence copy, approve→supply flow.
- R16. Supplying at a tick creates a position visible in the expanded row's position list without reload (cache invalidation works). The DEMAND column populates after a borrow occurs (Ponder indexes `BorrowerLoanPoolCreated`).
- R17. Single-tick rendering: if APR bounds are not widened (1000/1000), ladder renders one row — no crash, no special-case.

**S3 — Deposit PT**

- R18. DEPOSIT PT mode: amount input, deposit cap display ("DEPOSIT CAP: NONE" when 0 = unlimited), approve→deposit flow. After deposit, a Sablier stream appears in the position list without reload.
- R19. Deposit cap enforcement: if `marketDepositLimits` is nonzero, entering an amount that would exceed the cap disables submit with a dim mono caption.

**S4 — Stream Cards**

- R20. Stream cards show: progress bar (streamed fraction), "CLAIMABLE NOW \<withdrawable\> [CLAIM]", "REMAINING \<deposited - withdrawn - withdrawable\> · ENDS \<date\>", borrow teaser ("⚡ BORROW ~\<upfront %\> UPFRONT"). Teaser hidden when no non-self liquidity. CLAIM disabled at 0 withdrawable with caption.
- R21. Clicking the teaser opens BORROW mode with that stream pre-selected.

**S5 — Loan Cards**

- R22. Loan cards show: header "LOAN #id · BACKED BY STREAM #streamId · @ \<aprBps\>%", obligation progress bar, "X of Y REPAID", "SELF-REPAYING FROM THE STREAM — NOTHING TO DO." No primary verb on open loans. REPAY behind ADVANCED disclosure.
- R23. CLOSE button appears only when `canCloseLoan({loan, withdrawable})` is true. Verify: a loan with `withdrawable < outstanding` shows no CLOSE. A loan with `withdrawable >= outstanding` shows CLOSE and it succeeds.
- R24. Settled loans render dimmed with SETTLED badge.

**S6 — Lender Pool Cards**

- R25. Lender cards show: "SUPPLY #id @ \<aprBps\>%", "IDLE \<availableLiquidity\> [WITHDRAW]", ADJUST RATE. aprBps is rendered (was previously fetched but not shown). WITHDRAW works and position disappears from list.
- R26. Pool claim-share cards show: pool aprBps, lender contribution, claimable. Claiming works and claimable updates.

**Claim-All Queue**

- R27. CLAIM ALL opens a review modal listing all queued txs (pool-claims + stream-claims) with kind, target, amount. Queue does NOT auto-start. CONFIRM QUEUE button starts signing.
- R28. Queue advances per-tx: PENDING → SIGNING → CONFIRMING → CONFIRMED. Each tx waits for its receipt before the next starts.
- R29. All confirmed: "ALL CLAIMS CONFIRMED" summary with DONE button (no auto-close).
- R30. Mid-queue failure: queue stops, remaining rows PENDING, RESUME button recomputes from live data.

**Adjust-Rate**

- R31. ADJUST RATE form: new tick dropdown, "MOVE \<idle\> FROM \<old\>% TO \<new\>%" summary, approve (if needed) → multicall submit. After confirmation, position's tick updates in the list without reload.
- R32. Adjust-rate on a position with `availableLiquidity === 0`: button disabled with caption.

**Edge Cases**

- R33. **No liquidity:** navigate to a market where no one has supplied. Ladder shows "NO LIQUIDITY YET — BE THE FIRST LENDER" + SUPPLY INSTEAD button. DEMAND column shows "—" with "NO DEMAND DATA" caption (Ponder) or zero bars with "NO LOANS 30D" (honest empty).
- R34. **Partial fill (borrow):** enter an amount exceeding the best tick's liquidity but within a deeper tick's. Verify the conscious tick-switching flow per R11. Submit at the deeper tick. Receipt shows actual amount with partial-fill caption if applicable.
- R35. **Matured market:** use `anvil_mine` with a future timestamp past the market expiry, or `cast rpc anvil_setBlockTimestampInterval` to fast-forward. Verify: BORROW/SUPPLY disabled with "MARKET MATURED", DEPOSIT PT hidden, CLAIM PT visible, UNWRAP visible, stream CLAIM visible, pool CLAIM SHARE visible.
- R36. **Signer switch:** open a form (BORROW with stream selected + amount entered). Switch to a different account in the wallet extension. Verify: expanded row collapses, form body replaced with "WALLET CHANGED — RE-ENTER" caption.
- R37. **Wrap reserve empty:** use `cast call <OVRFLO> 'wrappedUnderlying()'` to check. If zero, UNWRAP button disabled with "WRAP RESERVE EMPTY" caption. If nonzero, UNWRAP works.
- R38. **Truncation warning (tooLarge):** supply 501+ liquidity positions across different ticks (scriptable via `cast send` in a loop). Verify "SHOWING FIRST 500 — DATA TRUNCATED" warning appears. If all 500 are withdrawn, verify the stronger copy "SHOWING FIRST 500 — ACTIVE LIQUIDITY MAY EXIST BEYOND SCAN RANGE".
- R39. **Slippage tolerance adjustment:** set slippage to 0.01% (1 bps). Submit a borrow. If the block timestamp drifts enough, expect a slippage revert → R14 re-quote banner. Set slippage to 5.0% (500 bps). Submit the same borrow. Expect success (looser tolerance absorbs drift).
- R40. **Ponder-off degradation:** kill the Ponder process (`kill $(cat .bootstrap.ponder.pid)`). Refresh the page. Verify: stream cards, BORROW stream selector, and CLAIM STREAM show "STREAM DATA UNAVAILABLE — RETRY" with a manual retry button. Demand column shows "—" with "NO DEMAND DATA". Markets table, balances, and non-stream surfaces remain functional. Restart Ponder and verify recovery.

**Visual Inspection (DESIGN.md Compliance)**

- R41. Canvas: near-black background (#050505). Grid lines (#333333). No drop shadows. Sharp corners (≤2px).
- R42. Typography: IBM Plex Mono for all financial data, table headers, structural labels. Inter for prose/buttons. Tabular-nums on numeric data.
- R43. Color semantics: gold (#ffcf00) for lend/supply. Cyan (#00e5ff) for borrow/obligation. Chalk (#f4f4f4) for neutral facts. Status colors used sparingly (green=confirmed, red=reverted, gold=warning).
- R44. Empty states: dim mono text inside bordered containers ("NO LIQUIDITY YET"), never illustrations.
- R45. Loading states: dim mono "—" or "LOADING" placeholders, no spinners or skeleton shimmer.
- R46. Buttons: transparent background, 1px border matching text color. Hover inverts (solid background, obsidian text).
- R47. Modals: carbon panel (#111111), 1px graphite border, centered on obsidian scrim (85% opacity). No blur, no shadow.
- R48. Motion: transitions limited to 0.2s ease on color/background/border. No movement, scaling, or parallax. Slide-in animation on overlay only.

**Responsive Testing**

- R49. Below 800px (resize browser or use DevTools): summary strip cells stack single-column, CLAIM ALL button full-width below. Mode buttons wrap vertical. APR ladder stacks vertically (depth bars below text). Claim-all modal queue rows scroll horizontally if needed. No reflow into cards for table surfaces.
- R50. At 1200px: fixed 1200px column with left/right graphite rails. Below 1200px: rails hug viewport with 2rem padding.

### Acceptance Examples

- AE1. **Covers R11.** Given the borrower enters an amount exceeding the 8% tick's liquidity, the quote panel shows a partial fill at 8% and a "SHOW OTHER TICKS" prompt. The 10% alternative is NOT visible. When the borrower clicks "SHOW OTHER TICKS", the 10% card appears. When the borrower selects it, the ladder highlights 10%.
- AE2. **Covers R13.** Given the borrower quotes at 8% and the lender drains position #1 via `cast send`, the borrower's submit reverts and the banner shows "LIQUIDITY CHANGED — NEW QUOTE:" with a RE-CONFIRM button.
- AE3. **Covers R35.** Given the market expiry is fast-forwarded via `anvil_mine`, the BORROW and SUPPLY buttons show "MARKET MATURED" captions, DEPOSIT PT is hidden, and CLAIM PT is visible.
- AE4. **Covers R40.** Given Ponder is killed, stream cards show "STREAM DATA UNAVAILABLE — RETRY" and the markets table remains fully functional.

### Scope Boundaries

**Out of scope:**

- Automated test execution (covered by the test suite plan `2026-07-23-002`).
- Devnet testing (covered by the devnet testing plan `2026-07-25-003`).
- Contract-level testing (covered by the Solidity test suite).
- Performance/load testing.
- Cross-browser testing (Chrome/Edge sufficient for v1; Firefox/Safari deferred).

---

## Implementation Units

### U1. Setup and environment preparation

- **Goal:** Bootstrap the local Anvil fork, widen APR bounds, verify all prerequisites.
- **Requirements:** R1, R2, R3.
- **Steps:**
  1. `npm --prefix web run bootstrap:local` — wait for dev server ready.
  2. `cat deployments/local.json` — record factory, ovrflo, token, lending, devWallet, lenderWallet.
  3. Widen APR bounds: `cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac09...ff80 --legacy <LENDING> 'setLendingAprBounds(uint16,uint16)' 800 1200`.
  4. Verify: `cast call --rpc-url http://127.0.0.1:8545 <LENDING> 'params()'` — confirm aprMinBps=800, aprMaxBps=1200.
  5. Set `NEXT_PUBLIC_REOWN_PROJECT_ID` in `web/.env.local` if missing. Restart dev server.
  6. Import dev wallet private key into browser wallet extension.
  7. Navigate to `localhost:3000` — confirm app loads, no console errors.
- **Pass criteria:** App loads, markets table renders two markets, wallet connects.

### U2. Seed initial state (supply liquidity from lender wallet)

- **Goal:** Create the liquidity state needed for borrow testing.
- **Requirements:** R15, R16.
- **Steps:**
  1. Connect the lender wallet (`0x3C44...3BC`).
  2. Expand the primary market row.
  3. Click SUPPLY mode button.
  4. Select the 8% tick in the dropdown.
  5. Enter 10 wstETH. Click APPROVE. Confirm in wallet. Wait for CONFIRMED.
  6. Click SUPPLY. Confirm in wallet. Wait for CONFIRMED.
  7. Repeat at the 10% tick with 5 wstETH.
  8. Verify: expanded row's position list shows two supply positions (8% and 10%) without page reload.
- **Pass criteria:** Two liquidity positions exist at 8% and 10%. RATES column shows "8–10% APR" range. DEMAND column shows "—" (no borrows yet).

### U3. S0 — Summary strip + markets table walkthrough

- **Goal:** Verify summary strip and table rendering across states.
- **Requirements:** R4, R5, R6, R7, R8.
- **Steps:**
  1. **Connected with positions (lender):** verify strip renders four cells. STREAMS = 0 (lender hasn't deposited). SUPPLIED = 15 wstETH (10 + 5). LOANS = 0. CLAIMABLE = 0 (no claimable yet). CLAIM ALL disabled.
  2. **Disconnected:** disconnect wallet. Verify no strip. Table still renders.
  3. **Reconnect as dev wallet (no positions):** verify no strip (zero positions).
  4. **Row expansion:** click primary market row → expands. Click secondary market row → primary collapses, secondary expands. Verify `aria-expanded` on rows. Verify expanded detail: balances (wstETH, PT, ovrfloToken), position list, mode buttons.
  5. **Mode button states:** with dev wallet connected, verify BORROW disabled with "NO STREAMS AVAILABLE" (dev wallet has no streams yet). SUPPLY enabled. DEPOSIT PT enabled (pre-maturity).
- **Pass criteria:** All states render correctly. Strip appears/disappears per connection + position state. Row accordion works.

### U4. S1 — Borrow mode walkthrough

- **Goal:** Exercise the full borrow flow including conscious tick-switching, slippage, and receipt display.
- **Requirements:** R9, R10, R11, R12.
- **Steps:**
  1. **Deposit PT to create a stream (dev wallet):** connect dev wallet. Expand primary market. Click DEPOSIT PT. Enter 100 PT. Approve + deposit. Wait for Sablier stream to appear in position list.
  2. **Open BORROW mode:** click BORROW. Verify stream selector shows the stream from step 1. Verify ladder shows 8% (BEST, selected) and 10% ticks. Verify depth bars and upfront % per row.
  3. **Full amount at best tick:** enter an amount within the 8% tick's 10 wstETH liquidity. Verify quote: "YOU RECEIVE NOW: \<net\> (\<upfront %\>)", "STREAM REPAYS: \<obligation\> over Nd". Verify slippage input shows "0.5%". Submit. Confirm in wallet. Wait for CONFIRMED. Verify receipt display shows actual received amount.
  4. **Partial fill + conscious tick-switching:** enter an amount exceeding 8% liquidity (e.g., 12 wstETH). Verify partial-fill quote at 8% ("GET $X AT 8% — PARTIAL FILL"). Verify "SHOW OTHER TICKS" prompt. Verify 10% alternative is NOT visible. Click "SHOW OTHER TICKS". Verify 10% card appears ("GET $Y AT 10% — FULL"). Click the 10% card. Verify ladder updates to show 10% selected. Submit. Confirm.
  5. **Slippage adjustment:** open a new BORROW (if stream still has remaining value). Change slippage to "1.0%". Verify the quote updates. Submit and confirm.
- **Pass criteria:** Borrow flow completes. Conscious tick-switching gates alternatives behind explicit user action. Slippage input is editable and affects the quote. Receipt shows actual amounts.

### U5. Race simulation and revert classification

- **Goal:** Verify R14 re-quote recovery and revert classification.
- **Requirements:** R13, R14.
- **Steps:**
  1. **Race simulation:** connect dev wallet. Open BORROW. Quote at 8% for an amount within liquidity. Without submitting, switch to lender wallet in the browser. In a terminal: `cast send --rpc-url http://127.0.0.1:8545 --private-key 0x5de4...793BC --legacy <LENDING> 'withdrawLiquidity(uint256)' <POSITION_ID>`. Switch back to dev wallet. Submit the borrow. Expect revert → "LIQUIDITY CHANGED — NEW QUOTE:" banner with RE-CONFIRM button. Click RE-CONFIRM. Expect new quote at the remaining tick.
  2. **Non-race revert (terminal error):** supply liquidity from the dev wallet's own account at 8%. Try to borrow against it. Expect "OVRFLOLending: self-match" → terminal error state with contract revert string, NO RE-CONFIRM button.
- **Pass criteria:** Race reverts route to re-quote banner. Non-race reverts route to terminal error. Classification is correct.

### U6. S2 — Supply mode walkthrough

- **Goal:** Exercise supply flow and verify demand column.
- **Requirements:** R15, R16, R17.
- **Steps:**
  1. Connect lender wallet. Expand primary market. Click SUPPLY.
  2. Verify lender-lens ladder: "YOU EARN +X% FIXED (Yd)", LIQUIDITY WAITING, DEMAND column.
  3. Select 9% tick. Enter 3 wstETH. Approve + supply. Verify position appears without reload.
  4. **Demand column:** after U4's borrow, verify the DEMAND column shows a bar at the tick where the borrow occurred, with "1 LOAN · \<amount\>".
  5. **Single-tick rendering:** if you skip the APR widening step (R2), verify the ladder renders one row without crashing.
- **Pass criteria:** Supply creates a position. Demand column reflects prior borrows. Single-tick rendering works.

### U7. Claim-all queue walkthrough

- **Goal:** Exercise the claim-all modal end-to-end.
- **Requirements:** R27, R28, R29, R30.
- **Steps:**
  1. **Accrue claimables:** after borrows and time passes (use `anvil_mine` to advance blocks), verify CLAIMABLE > 0 in the strip. Click CLAIM ALL.
  2. **Review gate:** verify modal lists all queued txs. Verify queue does NOT auto-start. CONFIRM QUEUE button present.
  3. **Happy path:** click CONFIRM QUEUE. Watch each tx advance: PENDING → SIGNING → CONFIRMING → CONFIRMED. Confirm each in wallet as prompted. After all confirm, verify "ALL CLAIMS CONFIRMED" with DONE button.
  4. **Mid-queue failure (optional):** reject a tx mid-queue. Verify queue stops, remaining rows PENDING, RESUME button appears. Click RESUME. Verify it recomputes from live data (dropped the failed tx).
- **Pass criteria:** Queue runs sequentially. Review gate works. Success state shows. Failure/RESUME works.

### U8. Adjust-rate walkthrough

- **Goal:** Exercise the adjust-rate multicall flow.
- **Requirements:** R31, R32.
- **Steps:**
  1. Connect lender wallet. Find a supply position at 8% in the expanded row's position list.
  2. Click ADJUST RATE on that position's card.
  3. Select 10% as the new tick. Verify summary: "MOVE \<idle\> FROM 8% TO 10%".
  4. If approval needed, click APPROVE. Then click the adjust button. Confirm the multicall in wallet.
  5. Verify: position's tick updates to 10% in the list without reload.
  6. **Disabled state:** find a position with `availableLiquidity === 0` (fully consumed by a borrow). Verify ADJUST RATE is disabled with caption.
- **Pass criteria:** Adjust-rate moves a position across ticks in one tx. Disabled state works.

### U9. Edge case sweep

- **Goal:** Walk through every edge case.
- **Requirements:** R33–R40.
- **Steps:** See each R-ID for the specific procedure. Key time-savers:
  - **Matured market (R35):** `cast rpc --rpc-url http://127.0.0.1:8545 anvil_setBlockTimestampInterval 10000` then `cast rpc anvil_mine 1` — this mines a block 10,000 seconds in the future. Repeat until past expiry. Reset with `anvil_setBlockTimestampInterval 0`.
  - **Truncation (R38):** script a loop: `for i in $(seq 1 501); do cast send ... 'supplyLiquidity(address,uint16,uint128)' <MARKET> 1000 1000000000000000000; done` (1 wstETH each at 10% tick). Verify warning.
  - **Ponder-off (R40):** `kill $(cat .bootstrap.ponder.pid)`. Refresh. Verify degradation. Restart: `PONDER_RPC_URL=http://127.0.0.1:8545 npm --prefix web run ponder:dev &`.
- **Pass criteria:** Every edge case produces the designed UI state, not a crash or blank screen.

### U10. Visual inspection pass

- **Goal:** Verify DESIGN.md compliance on every surface.
- **Requirements:** R41–R48.
- **Steps:** Walk through every screen with the visual inspection checklist (R41–R48). Use browser DevTools to inspect computed styles. Key checks:
  - Background color is #050505 on the main canvas.
  - No `box-shadow` anywhere (search DevTools).
  - All numeric data uses `font-family: 'IBM Plex Mono'` and `font-variant-numeric: tabular-nums`.
  - Buttons have transparent background + 1px border; hover inverts.
  - Modals have #111111 background, 1px #333333 border, no blur.
  - Empty states are dim mono text, not illustrations.
  - No spinners or skeleton shimmer (search for `animation` in DevTools that isn't the 0.2s color transition or the slide-in).
- **Pass criteria:** Every visual inspection item passes.

### U11. Responsive testing

- **Goal:** Verify responsive behavior at breakpoint boundaries.
- **Requirements:** R49, R50.
- **Steps:**
  1. Open Chrome DevTools → Toggle device toolbar.
  2. Set width to 1200px: verify fixed 1200px column with graphite rails.
  3. Set width to 1199px: verify rails hug viewport with 2rem padding.
  4. Set width to 799px: verify strip stacks, mode buttons wrap vertical, ladder stacks, queue rows scroll.
  5. Set width to 375px (mobile): verify all surfaces are usable (no horizontal overflow except intentional table scroll).
- **Pass criteria:** Responsive behavior matches DESIGN.md §12 at all breakpoints.

### U12. UI/UX scenario catalog (selectable via runner script)

- **Goal:** Provide a menu-driven scenario runner that sets up realistic contract state via `cast send`, then walks the tester through the UI as each persona (P1 Depositor, P2 Borrower, P3 Lender) would experience it. The goal is verifying UI/UX correctness, not protocol stress testing.
- **Requirements:** R2 (APR widening), R9–R12 (borrow flow), R15–R16 (supply flow), R18–R19 (position cards), R27 (maturity), R30 (signer switch), R33–R40 (edge cases).
- **Dependencies:** U1 (environment must be bootstrapped).
- **Files:** `script/local-ui-scenarios.sh` (created, replaces `local-stress-test.sh`).
- **Approach:** The runner script presents an interactive menu organized by persona walkthroughs, edge states, and setup utilities. Each scenario sets up on-chain state (supply liquidity, deposit PT, advance time), then prints step-by-step browser walkthrough instructions referencing the UX spec's screens (S0–S6) and personas (P1–P3). Scenarios can be run individually (`./script/local-ui-scenarios.sh p2`), in sequence (`./script/local-ui-scenarios.sh lively p1 p2 p3`), or via the interactive menu. All contract calls verified against `src/OVRFLOFactory.sol`, `src/OVRFLO.sol`, and `src/OVRFLOLending.sol`.
- **Scenario catalog:**

| ID | Category | Description | Persona/Screen |
|---|---|---|---|
| setup | Setup | Widen APR bounds to 800–1200 | — |
| lively | Seed | Lively market: 3 lenders × 5 ticks + 3 streams + 2 loans + claimable + demand | S0/S1/S2/S4/S5/S6 |
| reset | Setup | Re-seed from scratch | — |
| p1 | Persona | P1 Depositor: deposit PT → stream card → borrow teaser → claim | P1 / S0/S3/S4 |
| p1-exit | Persona | P1 Depositor Exit: post-maturity claim PT + unwrap | P1 / S0 |
| p2 | Persona | P2 Borrower: ladder → compare ticks → conscious switch → borrow → loan card | P2 / S1/S5 |
| p2-race | Persona | P2 Borrower Failure: liquidity race → re-quote banner | P2 / S1 |
| p3 | Persona | P3 Lender: demand → supply → position card → adjust rate → claim share | P3 / S2/S6 |
| empty | Edge | Empty ladder (no liquidity, 'BE THE FIRST LENDER') | S1 |
| mature | Edge | Post-maturity market (disabled modes, claim paths live) | S0 |
| deposit-cap | Edge | Deposit cap enforcement | S3 |
| self-match | Edge | Self-match exclusion (own liquidity excluded from ladder) | S1 |
| wrap-short | Edge | Wrap reserve empty (UNWRAP disabled) | S0 |
| truncation | Edge | 501+ positions (truncation warning) | S0/S1 |
| advance | Utility | Advance time for stream vesting / claimable accrual | — |

- **Recommended walkthrough sequences:**
  - First run: `lively` then `p1` then `p2` then `p3` (seed a rich market, walk all 3 personas)
  - Edge sweep: `empty` → `mature` → `deposit-cap` → `self-match` → `wrap-short` → `truncation`
  - Race test: `lively` then `p2-race` (drain liquidity between quote and submit)
  - Post-maturity: `mature` then `p1-exit`
- **Pass criteria:** Each persona walkthrough matches the UX spec's screen designs (S0–S6) and journey maps. Edge states produce the designed UI state, not a crash or blank screen.

### U13. Teardown

- **Goal:** Clean shutdown and verify re-bootstrap works.
- **Requirements:** R3.
- **Steps:**
  1. `npm --prefix web run bootstrap:local:clean`
  2. Verify anvil and Ponder processes are stopped (`ps aux | grep -E 'anvil|ponder'`).
  3. Verify `.bootstrap.pid` and `.bootstrap.ponder.pid` are removed.
  4. Re-run `npm --prefix web run bootstrap:local` — verify it starts cleanly (no "already running" error).
  5. Clean again.
- **Pass criteria:** Clean teardown. Re-bootstrap works.

---

## Verification Contract

| Gate | Method | Applies to |
|---|---|---|
| Scenario completion | Manual walkthrough of U1–U13 | All scenarios |
| Visual inspection | DESIGN.md compliance checklist (R41–R48) | U10 |
| Responsive | Browser DevTools at 1200px, 1199px, 799px, 375px | U11 |
| Ponder-off | Kill Ponder, verify degradation, restart | U9 (R40) |
| Teardown | bootstrap:local:clean + re-bootstrap | U13 |

---

## Definition of Done

- All R-IDs (R1 through R50) verified in the running app.
- Every screen (S0–S6) exercised through its happy path and primary edge state.
- Conscious tick-switching verified: alternatives gated behind "SHOW OTHER TICKS" click.
- Slippage tolerance verified: editable, affects minAcceptable.
- Race simulation produces re-quote banner, not a dead-end error.
- Revert classification routes non-race reverts to terminal error.
- Ponder-off degradation shows "STREAM DATA UNAVAILABLE — RETRY" on stream surfaces; non-stream surfaces remain functional.
- Visual inspection checklist passes on every surface.
- Responsive behavior matches DESIGN.md §12.
- `script/local-ui-scenarios.sh` runs and all scenarios complete successfully with correct browser verification results. Recommended sequence: `lively p1 p2 p3` then edge sweep (`empty mature deposit-cap self-match wrap-short truncation`).
- Persona walkthroughs match the UX spec's screen designs (S0–S6) and journey maps for P1 Depositor, P2 Borrower, and P3 Lender.
- Truncation scenario produces correct warning copy (DATA TRUNCATED vs ACTIVE LIQUIDITY MAY EXIST BEYOND SCAN RANGE).
- Maturity scenarios (ST16, ST17) correctly transition UI states at the boundary.
- Teardown and re-bootstrap work.
