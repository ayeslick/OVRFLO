---
title: Fizz Gap Closure - Plan
type: feat
date: 2026-07-05
topic: fizz-gap-closure
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** Close all 12 coverage gaps identified in the Fizz suite evaluation plan so the stateful fuzz harness exercises every reachable protocol path with faithful mocks and properties that catch real bugs.
- **Product authority:** This plan governs the `test/fizz/` fuzz suite only. Source contracts (`src/`) are not modified.
- **Open blockers:** None. All scope decisions resolved during brainstorm.
- **Execution profile:** Build-first, validate-last. All 8 units land, then one Medusa campaign validates the combined effect.
- **Stop conditions:** Campaign passes with 0 violations, or all violations are triaged as real bugs (reported) or harness false positives (fixed). Coverage must not regress below current levels.

---

## Product Contract

> Product Contract unchanged from brainstorm. GL-61 and GL-62 re-enablement confirmed during plan-time scoping (R6 adds the transfer handler they require).

### Summary

A comprehensive update to the Fizz stateful fuzz suite that closes all 12 gaps from the 2026-07-05 evaluation. The suite grows from 3 to 7 actors, gains a real flash loan borrower, exercises multi-offer pool creation and time-dependent paths, improves mock fidelity, and adds 3 missing properties - all validated in one Medusa campaign with end-of-line triage.

### Problem Frame

The Fizz suite passes cleanly (110 tests, 0 failures) and meets coverage targets (84-92% across contracts). But the evaluation plan exposed four structural blind spots: `createBorrowPool` only ever uses single-offer arrays, so pattern #11 (strictly-increasing IDs) and multi-contributor pro-rata claims are dead code in the harness. No handler advances time randomly, so `closeLoan` and `poolClaimLoan` success paths rarely fire. No `IFlashBorrower` implementation exists, so the flash loan callback and reentrancy window are untested. MockPendleOracle returns a fixed 0.95e18 rate, so deposit edge cases (rate near 1.0, rate above 1.0) and oracle freshness checks are unreachable. Eight smaller gaps round out the list: MockSablier doesn't enforce transferability, no property tests the sweepExcessPt guard (pattern #13), GL-57 (no free profit) and SP-62 (deposit liveness) are skipped, and several minor functions (prepareOracle, setTreasury, gatherOfferCapacities, direct ERC20 transfers) have no handler.

### Key Decisions

**One-shot implementation with end-of-line triage.** All 12 items land in one batch, then a single Medusa campaign validates the combined effect. Mock fidelity changes may surface real bugs or harness false positives; both are triaged after the campaign rather than incrementally.

**7 actors (up from 3).** Enables multi-contributor pool scenarios (4 offer makers + 1 borrower + 2 spare for stream sellers/buyers). Every global property that iterates actors does more work per call, but the state diversity is worth the gas cost.

**Handler-driven with 1-2 scenario handlers.** Each gap gets its own handler modification or new handler with properties added alongside. Two scenario handlers cover multi-step flows: a pool lifecycle scenario and a flash loan reentrancy scenario. Isolated handlers cover the remaining edge cases.

### Requirements

**Handler Coverage**

- R1. The `createBorrowPool` clamped handler generates arrays of 1-3 offer IDs with valid strictly-increasing ordering, exercising the multi-offer path in `_validateOffers` and `_consumeOffers` and enabling pools with multiple contributors.
- R2. A time-advancement handler advances the block timestamp by random amounts (0-365 days), exercising stream vesting, `closeLoan` success (withdrawable >= outstanding), and `poolClaimLoan` success (vested stream draw).
- R3. A `MockFlashBorrower` contract implementing `IFlashBorrower` is deployed and wired into the flash loan handler, exercising the callback path, fee payment, and the reentrancy window where the borrower can interact with the vault during the loan.
- R4. A `prepareOracle` handler exercises the factory's oracle preparation with TWAP durations at and outside the valid bounds, testing pattern #5 (TWAP bound consistency).
- R5. A `setTreasury` / `setBookTreasury` handler exercises the treasury setter through the factory forwarding path.
- R6. A direct ERC20 transfer handler exercises `ovrfloToken` self-transfers and zero-amount transfers between actors, enabling GL-61 and GL-62 properties.
- R7. A `gatherOfferCapacities` view assertion verifies that the returned capacities match the sum of active offers for the queried market and APR.

**Mock Fidelity**

- R8. `MockSablier.transferFrom` enforces the stream's `transferable` flag, matching real Sablier V2 behavior. Non-transferable streams revert on transfer, which `sellIntoOffer`, `postSaleListing`, and `createBorrowPool` must handle.
- R9. `MockPendleOracle` supports rate variation between approximately 0.8e18 and 1.02e18, exercisable by a handler or ghost variable. This tests the `toStream > 0` guard (rate near 1.0), the `toUser` cap (rate above 1.0), and varying deposit splits.

**New Properties**

- R10. GL-57 (no free profit) is implemented with ghost-variable tracking of each actor's starting token value (underlying + PT + ovrfloToken valued at the mock rate). No actor's total value exceeds their start plus legitimate yield from stream withdrawals.
- R11. SP-62 (deposit liveness) is implemented: when all preconditions are met (approved market, amount >= MIN_PT_AMOUNT, pre-maturity, within deposit limit), the deposit must succeed.
- R12. A property asserts that `sweepExcessPt` reverts when called with the underlying token address (not a registered PT), directly testing pattern #13 / guard G-18.

**Structural**

- R13. The actor count increases from 3 to 7. The `ACTOR_LABELS` array, `setupActors` loop, Medusa `senderAddresses`, and `toActor` modulus all reflect 7 actors. All actor-iteration loops in properties (GL-18, GL-60, etc.) iterate over 7 actors.
- R14. Medusa configuration updates: 7 sender addresses, `testLimit` increased to use more of the 600s timeout (the current campaign stops at 42s), and `blockTimestampDelayMax` increased to allow time advances approaching stream maturity.

**Scenario Handlers**

- R15. A pool lifecycle scenario handler posts offers from 2-3 actors, creates a multi-offer pool as a borrower, advances time past stream vesting, closes the loan, and claims pool shares - exercising the full lend-and-repay cycle in a single call sequence with property assertions at each step.
- R16. A flash loan reentrancy scenario handler calls `flashLoan` with a `MockFlashBorrower` that deposits into the vault during the callback, testing that the vault's state remains consistent after a reentrant deposit during the flash loan window.

### Success Criteria

- SC1. All 5 source contracts maintain or improve their current line coverage (OVRFLO >= 92%, OVRFLOBook >= 84%, Factory >= 85%, Token >= 88%, StreamPricing = 100%).
- SC2. The previously-uncovered paths are now hit: `closeLoan` success, `poolClaimLoan` success, `flashLoan` callback, multi-offer `_consumeOffers` loop, `prepareOracle` TWAP bound checks.
- SC3. All new properties (R10-R12) and re-enabled properties (GL-61, GL-62) pass or surface real bugs confirmed against source code.
- SC4. Any violations from mock fidelity changes are triaged: real bugs are reported, harness false positives are fixed with property rewrites.
- SC5. `forge build` compiles cleanly. `forge test --match-contract FoundryTester` passes. `PROPERTIES.md` checkboxes are updated for all implemented properties.

### Scope Boundaries

**Out of scope:**
- Echidna as a complementary fuzzer pass (Medusa only for this campaign)
- Oracle freshness/cardinality simulation in MockPendleOracle (would require a fundamentally different mock design; `getOracleState` remains hardcoded to fresh)
- Source contract modifications (`src/` is untouched; only `test/fizz/` changes)
- Fork tests, Foundry unit tests, and frontend tests (separate test suites)
- Increasing Medusa worker count beyond 10

### Dependencies

- The evaluation plan at `docs/plans/2026-07-05-001-fizz-coverage-evaluation-plan.md` is the source of truth for gap details and per-item rationale.
- The Fizz skill workflow provides the Medusa wrapper scripts and validation tooling.
- The x-ray invariant map (`x-ray/invariants.md`) and critical patterns (`docs/solutions/patterns/ovrflo-critical-patterns.md`) define what the properties must cover.

---

## Planning Contract

### Key Technical Decisions

**KTD1: MockFlashBorrower as a separate contract with a reentrancy flag.** A new `MockFlashBorrower.sol` under `test/fizz/mocks/` implements `IFlashBorrower.onFlashLoan`, returns the success hash, and pre-approves the vault for PT repayment and underlying fee payment. A boolean flag toggles reentrancy mode: when enabled, the borrower deposits into the vault during the callback. This lets the same contract serve both the standard flash loan handler (R3) and the reentrancy scenario handler (R16) without two separate mocks.

**KTD2: Multi-offer array generation from existing offer pool.** The clamped `createBorrowPool` handler uses a fuzz input to select array size (1-3), then picks valid offer IDs from the range `[1, nextOfferId-1]` with strictly-increasing ordering guaranteed by construction. The handler filters out offers owned by the current actor (self-match prevention) and skips inactive offers. This exercises the `_validateOffers` loop, the `offerIds[i] > offerIds[i-1]` check (pattern #11), and the `_consumeOffers` multi-offer accumulation path.

**KTD3: GL-57 value computation.** Each actor's total value is `underlying.balanceOf(actor) + ptToken.balanceOf(actor) + ovrfloToken.balanceOf(actor) * mockRate / 1e18`. The `ghost_actorStartValue` mapping (already in `Base.sol`) records the starting value at setup. The property asserts `currentValue <= startValue + totalStreamWithdrawals` for each actor. Stream withdrawals are tracked via a ghost variable updated in the Sablier withdraw path. This is EXPLORATORY (not a mathematical identity), so violations are leads for human review, not automatic bugs.

**KTD4: Medusa config targets.** `testLimit` increases from 500,000 to 1,000,000 to use more of the 600s timeout (current campaign stops at 42s). `blockTimestampDelayMax` increases from 604,800 (7 days) to 31,536,000 (365 days) to allow time advances approaching stream maturity. `senderAddresses` expands to 7 entries (`0x10000` through `0x70000`). `callSequenceLength` increases from 100 to 150 to accommodate multi-step scenario handlers.

**KTD5: Time advancement as a standalone handler.** A `fizz_skipTime(uint256)` handler advances time by `amount % 365 days` rather than embedding time skips inside other handlers. This keeps the fuzzer's call sequence unbiased - time advances happen randomly between protocol operations, not only when a specific handler fires. The handler also calls `skipBlocks` to keep block number and timestamp consistent.

### Assumptions

- `MockPendleOracle.getOracleState` remains hardcoded to `(false, 0, true)` - oracle freshness and cardinality are untestable without a fundamentally different mock. This is documented as out of scope.
- `MockSablier.withdraw` continues to allow the stream `sender` (vault) to withdraw, not just the owner. Real Sablier V2 is stricter, but this doesn't affect any protocol code path since the vault never calls `withdraw` directly.
- All existing 110 passing properties remain valid after structural changes. The 7-actor expansion is mechanical (array extension + modulus change) and shouldn't break any property logic.
- `PROPERTIES.md` uses `[-]` for skipped properties. Re-enabled properties flip to `[x]` when implemented.

### Sequencing

Units are dependency-ordered. U1 (structural) is the foundation. U2 (MockFlashBorrower) and U3 (mock fidelity) are independent of each other but both needed before downstream units. U4 and U5 (handler improvements) depend on U1 and optionally U2/U3. U6 (properties) depends on U1, U3, and U4 (transfer handler). U7 (scenarios) depends on U1, U2, and U5. U8 (validation) depends on all prior units.

```
U1 ──┬──> U4 ──> U6 ──┐
     ├──> U5 ──> U7 ──┼──> U8
U2 ──┘                │
U3 ──────────────────┘
```

---

## Implementation Units

### U1. Structural foundation: 7 actors and Medusa config

**Goal:** Expand the harness from 3 to 7 actors and update Medusa configuration for richer state diversity and longer campaigns.

**Requirements:** R13, R14

**Dependencies:** None (foundation unit)

**Files:** `test/fizz/Base.sol`, `medusa.json`

**Approach:** Extend `ACTOR_LABELS` to 7 entries. The `setupActors` loop already iterates `ACTOR_LABELS.length`, so it extends automatically. Add 4 sender addresses to `medusa.json` (`0x40000`, `0x50000`, `0x60000`, `0x70000`). Increase `testLimit` to 1,000,000 and `blockTimestampDelayMax` to 31,536,000. Increase `callSequenceLength` to 150.

**Test scenarios:**
- Happy path: 7 actors are deployed in `setup()`, each with `INITIAL_TOKEN_BALANCE` of underlying and PT, and approvals set to vault and book
- Edge case: `toActor` maps addresses across the full 0-6 range without collision
- Integration: `sumActorsERC20Balances` returns the correct sum across 7 actors

**Verification:** `forge build` compiles. `FoundryTester` `test_sequence` passes. Manual check: `medusa.json` has 7 sender addresses and updated limits.

---

### U2. MockFlashBorrower contract

**Goal:** Deploy an `IFlashBorrower` implementation that repays PT plus fee during the callback, with an optional reentrancy mode for the scenario handler.

**Requirements:** R3 (partial), R16 (partial)

**Dependencies:** None (new contract, no harness changes yet)

**Files:** `test/fizz/mocks/MockFlashBorrower.sol` (new)

**Approach:** Implement `onFlashLoan(address, uint256, uint256, bytes)` returning `keccak256("IFlashBorrower.onFlashLoan")`. In the constructor, set approvals on the vault for PT and underlying. Accept a `bool reenter` flag from the `bytes data` parameter: when true, call `vault.deposit` during the callback with a small amount of PT. The borrower holds PT and underlying tokens seeded by the handler.

**Test scenarios:**
- Happy path: flash loan with MockFlashBorrower succeeds, PT is repaid, fee is paid
- Edge case: reentrancy mode deposits into vault during callback without reverting
- Error path: borrower without sufficient PT reverts the flash loan

**Verification:** `forge build` compiles. Flash loan handler (U4) can call `vault.flashLoan` with `MockFlashBorrower` as the borrower.

---

### U3. Mock fidelity improvements

**Goal:** Fix MockSablier transferability enforcement and add MockPendleOracle rate variation with a handler to exercise it.

**Requirements:** R8, R9

**Dependencies:** U1 (for actor count in rate handler)

**Files:** `test/fizz/mocks/MockSablier.sol`, `test/fizz/mocks/MockPendleOracle.sol`, `test/fizz/handlers/OVRFLOHandler.sol`

**Approach:** In `MockSablier.transferFrom`, add `require(streams[tokenId].transferable, "not transferable")` before the ownership check. In `MockPendleOracle`, the `setRate` function already exists; add a handler `oVRFLO_setOracleRate(uint256)` that clamps the rate to `[0.8e18, 1.02e18]` and calls `mockOracle.setRate`. Add this to the OVRFLO secondary dispatcher.

**Test scenarios:**
- Happy path: transferable stream can be transferred via `transferFrom`
- Error path: non-transferable stream reverts on `transferFrom`
- Happy path: rate variation handler changes the oracle rate
- Edge case: rate at exactly 1.0e18 causes `toStream == 0` revert in deposit (exercises G-10 guard)
- Edge case: rate above 1.0e18 exercises `toUser` cap and `toStream > 0` guard interaction

**Verification:** `forge build` compiles. Deposit handler reaches the `toStream > 0` guard with rate near 1.0. `sellIntoOffer` reverts when the stream is non-transferable.

---

### U4. OVRFLO handler improvements

**Goal:** Add time advancement, flash loan callback wiring, ERC20 transfer, and prepareOracle handlers to the OVRFLO handler.

**Requirements:** R2, R3, R4, R5 (partial), R6

**Dependencies:** U1 (actor count), U2 (MockFlashBorrower), U3 (rate handler added to dispatcher)

**Files:** `test/fizz/handlers/OVRFLOHandler.sol`, `test/fizz/handlers/Handlers.sol`

**Approach:** Add `fizz_skipTime(uint256 amount)` that calls `skipTime(amount % 365 days)`. Modify `oVRFLO_flashLoan_clamped` to deploy and use `MockFlashBorrower` instead of passing empty data. Add `oVRFLO_transfer(uint256 toSeed, uint256 amount)` that transfers `ovrfloToken` between actors using `toActor`. Add `_oVRFLO_prepareOracle(uint32 twapDuration)` to the secondary dispatcher, exercising both valid and invalid TWAP durations. Add `_oVRFLO_setMarketDepositLimit` to the secondary dispatcher for the `setTreasury` path (R5 is shared with U5 for the book side).

**Test scenarios:**
- Happy path: `fizz_skipTime` advances time and streams vest accordingly
- Happy path: flash loan with MockFlashBorrower succeeds and exercises the callback
- Happy path: ERC20 self-transfer (`to == actor`) doesn't change balance or totalSupply
- Edge case: zero-amount transfer doesn't change any state
- Edge case: `prepareOracle` with TWAP below `MIN_TWAP_DURATION` reverts
- Edge case: `prepareOracle` with TWAP above `MAX_TWAP_DURATION` reverts

**Verification:** `forge build` compiles. Medusa coverage hits the flash loan callback path. `prepareOracle` TWAP bound checks appear in coverage.

---

### U5. OVRFLOBook handler improvements

**Goal:** Add multi-offer `createBorrowPool`, `setTreasury`/`setBookTreasury`, and `gatherOfferCapacities` view assertion.

**Requirements:** R1, R5 (partial), R7

**Dependencies:** U1 (actor count for multi-offer)

**Files:** `test/fizz/handlers/OVRFLOBookHandler.sol`, `test/fizz/handlers/Handlers.sol`

**Approach:** Modify `oVRFLOBook_createBorrowPool_clamped` to generate 1-3 offer arrays: use a fuzz input to select size, pick valid active offers from `[1, nextOfferId-1]` excluding the current actor's offers, sort them ascending. Add `_oVRFLOBook_setTreasury(address)` to the secondary dispatcher. Add a `gatherOfferCapacities` assertion that calls the view and checks the returned total against the sum of active offer capacities for the queried market and APR.

**Test scenarios:**
- Happy path: 2-offer pool creates successfully with two distinct contributors
- Happy path: 3-offer pool creates successfully with three distinct contributors
- Edge case: strictly-increasing ID check fires when duplicate IDs would be passed
- Edge case: self-match prevention fires when borrower owns one of the offers
- Happy path: `gatherOfferCapacities` returns the correct sum for a given market and APR
- Happy path: `setBookTreasury` updates the treasury address through the factory

**Verification:** `forge build` compiles. Medusa coverage hits the `_consumeOffers` loop with multiple offers. Pools with multiple contributors exist in the campaign state.

---

### U6. New and re-enabled properties

**Goal:** Implement GL-57 (no free profit), SP-62 (deposit liveness), pattern #13 guard (sweepExcessPt), and re-enable GL-61 and GL-62 (ERC20 transfer invariants).

**Requirements:** R10, R11, R12, GL-61, GL-62

**Dependencies:** U1 (actor iteration), U3 (mock rate for GL-57 valuation), U4 (transfer handler for GL-61/GL-62)

**Files:** `test/fizz/Properties.sol`, `PROPERTIES.md`

**Approach:** GL-57: add `property_no_free_profit()` that iterates actors and checks `currentValue <= ghost_actorStartValue[actor] + ghost_totalStreamWithdrawals[actor]`. SP-62: add `property_deposit_liveness()` called from the deposit handler that verifies a deposit with valid preconditions (approved market, amount >= MIN_PT_AMOUNT, pre-maturity, within limit) succeeds without revert. Pattern #13: add `property_sweepExcessPt_reverts_non_pt()` that calls `sweepExcessPt` with the underlying address and asserts it reverts. GL-61: add `property_self_transfer_noop()` called from the transfer handler. GL-62: add `property_zero_transfer_noop()` called from the transfer handler. Update `PROPERTIES.md` checkboxes from `[-]` to `[x]` for all five.

**Test scenarios:**
- Happy path: GL-57 passes when no actor has gained unexplained value
- Edge case: GL-57 flags if an actor's value exceeds start + withdrawals (EXPLORATORY, lead for review)
- Happy path: SP-62 confirms deposit succeeds when all preconditions are met
- Happy path: pattern #13 property confirms `sweepExcessPt` reverts with underlying address
- Happy path: GL-61 confirms self-transfer doesn't change balance or supply
- Happy path: GL-62 confirms zero-transfer doesn't change state

**Verification:** `forge build` compiles. All 5 properties appear as `property_*` functions in the Medusa test list. `PROPERTIES.md` shows `[x]` for GL-57, GL-61, GL-62, SP-62, and the new pattern #13 property.

---

### U7. Scenario handlers

**Goal:** Add a pool lifecycle scenario and a flash loan reentrancy scenario that exercise multi-step protocol flows in a single call sequence.

**Requirements:** R15, R16

**Dependencies:** U1 (actors), U2 (MockFlashBorrower with reentrancy flag), U5 (multi-offer pool creation)

**Files:** `test/fizz/handlers/OVRFLOBookHandler.sol`, `test/fizz/handlers/OVRFLOHandler.sol`

**Approach:** Pool lifecycle (`scenario_poolLifecycle`): as actor A, post an offer; as actor B, post another offer; as actor C (who has deposited and owns a stream), call `createBorrowPool` with both offer IDs; advance time past stream vesting; call `closeLoan`; as actor A, call `claimPoolShare`; as actor B, call `claimPoolShare`. Assert conservation properties at each step. Flash loan reentrancy (`scenario_flashLoanReentrancy`): deploy `MockFlashBorrower` with reentrancy enabled, seed it with PT and underlying, call `vault.flashLoan`. Assert that vault state (MTD, wrappedUnderlying, totalSupply) is consistent after the reentrant deposit.

**Test scenarios:**
- Happy path: pool lifecycle completes full cycle (post offers, create pool, vest, close, claim)
- Integration: pool conservation (SP-25) holds at each step of the lifecycle
- Integration: pro-rata entitlement (SP-24) holds for both contributors after claims
- Happy path: flash loan reentrancy succeeds and vault state is consistent
- Edge case: flash loan reentrancy with insufficient PT for deposit during callback reverts cleanly

**Verification:** `forge build` compiles. Both scenario handlers appear in the Medusa test list. Coverage hits `closeLoan` success and `claimPoolShare` success paths.

---

### U8. Campaign validation and triage

**Goal:** Run the full Medusa campaign, verify coverage, triage any violations, and update artifacts.

**Requirements:** SC1, SC2, SC3, SC4, SC5

**Dependencies:** U1, U2, U3, U4, U5, U6, U7 (all prior units)

**Files:** `fizz_data/coverage-targets.md`, `PROPERTIES.md`, `fizz_data/report.md`, `fizz_data/last-run.json`

**Approach:** Run `forge build` to verify compilation. Run Medusa coverage mode to check that previously-uncovered paths are now hit (closeLoan success, poolClaimLoan success, flashLoan callback, multi-offer _consumeOffers, prepareOracle TWAP bounds). Run full Medusa campaign with 600s timeout. For each violation: read the call sequence, determine if it's a real bug (protocol violates a SHOULD-HOLD property) or a harness false positive (property assertion is wrong or handler has a bug). Fix false positives with property rewrites. Report real bugs. Update `PROPERTIES.md` checkboxes. Refresh `fizz_data/last-run.json` with `fizz_sync.js --refresh-snapshot`. Update `fizz_data/report.md` with campaign results.

**Test scenarios:**
- Coverage check: all 5 contracts at or above current levels
- Path check: closeLoan success path hit in coverage report
- Path check: poolClaimLoan success path hit in coverage report
- Path check: flashLoan callback path hit in coverage report
- Path check: multi-offer _consumeOffers loop hit in coverage report
- Violation triage: each violation classified as real bug or false positive

**Verification:** Campaign passes with 0 violations, or all violations are triaged. `forge test --match-contract FoundryTester` passes. `PROPERTIES.md` checkboxes updated. `fizz_data/last-run.json` refreshed.

---

## Verification Contract

| Gate | Command | When |
|------|---------|------|
| Compilation | `forge build` | After each unit, before Medusa runs |
| Foundry smoke | `forge test --match-contract FoundryTester` | After all units, before campaign |
| Coverage check | `node fizz_skill_path/scripts/run_medusa.js . --meta-dir fizz_data --coverage-mode` | After all units |
| Full campaign | `node fizz_skill_path/scripts/run_medusa.js . --meta-dir fizz_data --timeout 600` | After coverage check passes |
| Artifact refresh | `node fizz_skill_path/scripts/fizz_sync.js . --refresh-snapshot --meta-dir fizz_data --suite-dir test/fizz` | After campaign triage |

Coverage targets (no-ir fuzz profile, accurate numbers):

| Contract | Current | Target |
|----------|---------|--------|
| OVRFLO.sol | 92% | >= 92% |
| OVRFLOBook.sol | 84% | >= 84% |
| OVRFLOFactory.sol | 85% | >= 85% |
| OVRFLOToken.sol | 88% | >= 88% |
| StreamPricing.sol | 100% | = 100% |

---

## Definition of Done

**Global criteria:**
- All 8 implementation units are complete and verified
- `forge build` compiles cleanly with no warnings beyond existing baseline
- `forge test --match-contract FoundryTester` passes
- Medusa campaign runs to completion (either 0 violations or all triaged)
- Coverage does not regress below current levels on any contract
- `PROPERTIES.md` checkboxes updated for all implemented/re-enabled properties
- `fizz_data/coverage-targets.md` updated with new cycle results
- `fizz_data/last-run.json` refreshed
- No abandoned/experimental code left in the diff

**Per-unit criteria:**
- U1: 7 actors deploy with tokens and approvals; Medusa config has 7 senders
- U2: MockFlashBorrower compiles and can be used as a flash loan borrower
- U3: MockSablier enforces transferability; oracle rate varies in campaign
- U4: Time advancement, flash loan callback, ERC20 transfer, prepareOracle all reachable in coverage
- U5: Multi-offer pools with 2-3 contributors exist in campaign state
- U6: 5 new/re-enabled properties appear in Medusa test list and PROPERTIES.md
- U7: Both scenario handlers exercise their full multi-step flows in coverage
- U8: Campaign results documented, violations triaged, artifacts refreshed
