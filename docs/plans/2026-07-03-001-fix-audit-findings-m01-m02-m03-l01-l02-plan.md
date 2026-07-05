---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "fix: Resolve audit findings M-01 through M-03, L-01, L-02"
date: 2026-07-03
type: fix
---

## Goal Capsule

Fix all five findings from `AUDIT_FINDINGS.md`: three Medium (M-01 pool proceeds stranding, M-02 gross-vs-net slippage, M-03 oracle freshness) and two Low (L-01 quote validation gaps, L-02 APR bounds footgun). Each fix is independent and can be committed separately.

**Authority hierarchy:** Audit findings in `AUDIT_FINDINGS.md` are the source. Code in `src/OVRFLOBook.sol` and `src/OVRFLO.sol` is the target. Tests in `test/OVRFLOBook.t.sol` and `test/OVRFLOBookInvariant.t.sol` verify. Existing patterns in `docs/solutions/patterns/ovrflo-critical-patterns.md` guide.

**Stop conditions:** All 5 findings fixed, all tests pass (unit + invariant + fork), `forge build` clean, `forge fmt` clean.

## Product Contract

### Requirements

- **R1 (M-01):** `claimPoolShare` must compute each contributor's claimable proceeds from cumulative pool proceeds, not the current shrinking pot. Minority contributors must not be permanently stranded after majority contributors claim.
- **R2 (M-02):** `createBorrowPool` slippage check must protect the net borrower proceeds (`netToBorrower`), not the gross principal (`actualBorrow`), consistent with `sellIntoOffer`'s `minNetOut` protection.
- **R3 (M-03):** `deposit` and `flashLoan` must verify oracle freshness via `getOracleState` before consuming `getPtToSyRate`, matching the check `addMarket` performs at onboarding.
- **R4 (L-01):** `quote` must validate `aprBps` via `_validateApr` and guard `grossPrice > 0`, mirroring state-changing paths.
- **R5 (L-02):** `setAprBounds` must reject bounds that contain no valid APR step (require both bounds step-aligned).

## Planning Contract

### Key Technical Decisions

**KTD-1: Remove the pro-rata cap (M-01).** The current pro-rata cap (`proRataShare = poolProceeds * contribution / totalContributed`) causes the stranding — it shrinks as claims drain the pot, flooring minority shares to zero. The simplest fix is to remove it entirely and cap claims by `min(remaining, poolProceeds)` instead. `poolReceived` already prevents any contributor from claiming more than their total entitlement, and `poolProceeds` caps at what's actually in the pot. No new storage variables, no changes to `closeLoan` or `repayLoan` — this is a net simplification (less code). Tradeoff: first-come-first-served on proceeds rather than fair distribution, but no one is stranded. The audit's cumulative-tracking approach was rejected as over-engineered for a contract not yet deployed.

**KTD-2: Reuse `minAcceptable` for net check (M-02).** Change the existing `require(actualBorrow >= minAcceptable)` to `require(netToBorrower >= minAcceptable)` after `netToBorrower` is computed. Update NatSpec to clarify `minAcceptable` is the minimum net proceeds. Alternative: add a separate `minNetToBorrower` parameter — rejected as unnecessary complexity since the contract is not yet deployed and the parameter name is generic enough to cover net proceeds.

**KTD-3: On-chain oracle freshness check (M-03).** Call `IPendleOracle(oracle).getOracleState(market, info.twapDurationFixed)` in `deposit` and `flashLoan`, reverting if `oldestObservationSatisfied` is false. This matches the factory's `addMarket` check. The oracle is a Pendle protocol contract, not multisig-controlled, so the user preference "prefer off-chain multisig verification over redundant on-chain checks" does not apply — the multisig controls market onboarding, not oracle data quality. Gas cost is one view call, negligible relative to the rest of `deposit` (token transfers + Sablier stream creation).

**KTD-4: Both bounds step-aligned (L-02).** Require `aprMinBps_ % APR_STEP_BPS == 0 && aprMaxBps_ % APR_STEP_BPS == 0` in `setAprBounds`. Simpler than auditing the range for at least one valid step, and more intuitive — bounds should be valid APRs themselves.

### Assumptions

- Contract is not yet deployed to mainnet (deployments are TBD), so function semantics are safe to change.
- Existing tests will need adjustment for M-01 (claim cap removal) and M-02 (slippage check semantics change).

## Implementation Units

### U1. Fix M-01: Remove pro-rata cap in claimPoolShare

**Goal:** Eliminate the shrinking-pot stranding by removing the pro-rata cap that causes it.

**Requirements:** R1

**Files:**
- `src/OVRFLOBook.sol` — simplify `claimPoolShare` (remove pro-rata computation, no new storage)
- `test/OVRFLOBook.t.sol` — update existing claim tests, add stranding regression test

**Approach:**
1. In `claimPoolShare`, remove the `proRataShare` computation and its comment
2. Replace with `available = remaining`, capped by `poolProceeds[poolId]`:
   ```
   uint256 available = remaining;
   if (uint256(poolProceeds[poolId]) < available) available = uint256(poolProceeds[poolId]);
   ```
3. No changes to `closeLoan`, `repayLoan`, or any storage variables
4. Remove the pro-rata comment ("Pro-rata cap: each claim limited to...")

**Patterns to follow:** `poolClaimLoan` already uses a simple `min(amount, remaining, streamClaimable)` pattern — `claimPoolShare` should be equally simple.

**Test scenarios:**
- **Stranding regression:** `totalContributed=100`, A=99, B=1, `poolProceeds=100`. A claims 99. B claims 1 — must succeed (currently fails with `proRataShare = 1*1/100 = 0`)
- **Happy path:** Two equal contributors claim from pool proceeds — both receive their full entitlement
- **Edge case (partial proceeds):** `poolProceeds < remaining` — claim capped by available pot, remaining claimable when more proceeds arrive
- **Edge case (pot exhausted):** First contributor claims all available `poolProceeds`, second contributor waits for more — not stranded, just delayed
- **Error path:** Contributor with `poolReceived >= entitlement` — reverts "fully claimed"

**Verification:** `forge test --match-contract OVRFLOBookTest` passes with updated claim tests.

---

### U2. Fix M-02: Net slippage check in createBorrowPool

**Goal:** `minAcceptable` must protect the net borrower proceeds, not the gross principal.

**Requirements:** R2

**Files:**
- `src/OVRFLOBook.sol` — `createBorrowPool` function
- `test/OVRFLOBook.t.sol` — update slippage tests

**Approach:**
1. Move the `require(actualBorrow >= minAcceptable)` check from before fee computation to after `netToBorrower` is computed
2. Change to `require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage")`
3. Update the `@param minAcceptable` NatSpec to clarify it protects net borrower proceeds
4. Keep `require(actualBorrow <= grossPrice, "OVRFLOBook: borrow above price")` where it is (this is a price sanity check, not a slippage check)

**Patterns to follow:** `sellIntoOffer` uses `minNetOut` for the same purpose — `createBorrowPool` should be consistent.

**Test scenarios:**
- **Happy path:** Borrower passes `minAcceptable` equal to expected `netToBorrower` — succeeds
- **Edge case (fee at max):** `feeBps = 10000` (100%), `actualBorrow = 100`, `minAcceptable = 1` — reverts because `netToBorrower = 0 < 1`
- **Edge case (fee at zero):** `feeBps = 0`, `netToBorrower = actualBorrow` — `minAcceptable` check equivalent to old behavior
- **Edge case (fee change between blocks):** Fee is raised between simulation blocks — borrower's tx reverts if `netToBorrower < minAcceptable`
- **Error path:** `minAcceptable > netToBorrower` — reverts with "OVRFLOBook: slippage"

**Verification:** `forge test --match-test "CreateBorrowPool|Slippage"` passes.

---

### U3. Fix M-03: Oracle freshness check in deposit and flashLoan

**Goal:** Verify oracle data quality before consuming the PT-to-SY rate in live settlement paths.

**Requirements:** R3

**Files:**
- `src/OVRFLO.sol` — `deposit` and `flashLoan` functions
- `test/OVRFLOBook.t.sol` or `test/OVRFLO.t.sol` — add oracle staleness test (may require mocking)

**Approach:**
1. Add an internal helper `_requireOracleFresh(address market, uint32 twapDuration)` that calls `IPendleOracle(oracle).getOracleState(market, twapDuration)` and requires `oldestObservationSatisfied`
2. Call `_requireOracleFresh(market, info.twapDurationFixed)` in `deposit` before `getPtToSyRate`
3. Call `_requireOracleFresh(market, info.twapDurationFixed)` in `flashLoan` before `getPtToSyRate`
4. Do not check `increaseCardinalityRequired` — that is a setup concern handled by `prepareOracle`/`addMarket`, not a runtime freshness signal

**Patterns to follow:** `OVRFLOFactory.addMarket` performs the same check at onboarding (lines 196-201). `StreamPricing.marketActive` and `requireEligible` are existing cross-contract validation patterns.

**Test scenarios:**
- **Happy path:** Normal deposit with fresh oracle — succeeds unchanged
- **Error path (stale oracle):** Mock `getOracleState` to return `oldestObservationSatisfied = false` — `deposit` reverts
- **Error path (stale oracle in flashLoan):** Same mock for `flashLoan` — reverts
- **Integration:** Verify the revert error message is distinguishable from other deposit failures

**Verification:** `forge build` clean. Fork tests still pass (oracle is fresh on mainnet fork).

---

### U4. Fix L-01: APR validation and grossPrice guard in quote

**Goal:** `quote` should reject inputs that state-changing paths would reject.

**Requirements:** R4

**Files:**
- `src/OVRFLOBook.sol` — `quote` function
- `test/OVRFLOBook.t.sol` — add quote validation tests

**Approach:**
1. Add `_validateApr(aprBps)` at the top of `quote`, after `_requireEligible`
2. Add `require(grossPrice > 0, "OVRFLOBook: price zero")` after computing `grossPrice`, before the `effectiveBorrowAmount` check

**Patterns to follow:** `sellIntoOffer`, `buyListing`, and `createBorrowPool` all call `_validateApr` implicitly (via `postOffer`/`postSaleListing`) and check `grossPrice > 0`. `quote` should mirror these guards.

**Test scenarios:**
- **Happy path:** Valid APR within bounds, positive gross price — quote succeeds unchanged
- **Error path (APR out of bounds):** `aprBps` outside `[aprMinBps, aprMaxBps]` — reverts "OVRFLOBook: apr out of bounds"
- **Error path (APR not whole):** `aprBps = 50` (not a multiple of 100) — reverts "OVRFLOBook: apr not whole"
- **Error path (zero price):** Stream fully withdrawn (`remaining = 0`) — reverts "OVRFLOBook: price zero"

**Verification:** `forge test --match-test "Quote"` passes.

---

### U5. Fix L-02: Step-aligned APR bounds in setAprBounds

**Goal:** Prevent admin from configuring APR bounds that contain no valid APR step.

**Requirements:** R5

**Files:**
- `src/OVRFLOBook.sol` — `setAprBounds` function
- `test/OVRFLOBook.t.sol` — update `test_Admin_SetAprBounds`

**Approach:**
1. Add `require(aprMinBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMin not step-aligned")` and `require(aprMaxBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMax not step-aligned")` in `setAprBounds`
2. Update NatSpec to note both bounds must be multiples of `APR_STEP_BPS`

**Patterns to follow:** `_validateApr` already enforces `aprBps % APR_STEP_BPS == 0` on every post. The bounds themselves should satisfy the same constraint.

**Test scenarios:**
- **Happy path:** `setAprBounds(1000, 5000)` — succeeds (both multiples of 100)
- **Error path (min not aligned):** `setAprBounds(50, 5000)` — reverts "OVRFLOBook: aprMin not step-aligned"
- **Error path (max not aligned):** `setAprBounds(1000, 5050)` — reverts "OVRFLOBook: aprMax not step-aligned"
- **Error path (both not aligned):** `setAprBounds(50, 99)` — reverts on first check

**Verification:** `forge test --match-test "AprBounds"` passes.

---

### U6. Update audit findings doc and critical patterns

**Goal:** Mark all findings as resolved and update pattern docs if the fixes change documented patterns.

**Requirements:** R1-R5 (documentation)

**Files:**
- `AUDIT_FINDINGS.md` — mark M-01, M-02, M-03, L-01, L-02 as resolved with fix references
- `docs/solutions/patterns/ovrflo-critical-patterns.md` — update pattern #12 (pro-rata cap) to reflect removal
- `docs/audit/rejected-findings-record.md` — no changes needed (none of the 5 findings were rejected)

**Approach:**
1. Add "Fixed" status to each finding in `AUDIT_FINDINGS.md` with a brief note on the fix applied
2. Update pattern #12 — the pro-rata cap is removed, not replaced. Update the pattern to reflect that `claimPoolShare` uses `min(remaining, poolProceeds)` without pro-rata distribution
3. No storage layout changes to document in pattern #7

**Test scenarios:** None — documentation only.

**Verification:** `AUDIT_FINDINGS.md` shows all 5 findings as resolved. Pattern docs are consistent with the new code.

## Verification Contract

```bash
# Build
forge build

# Unit tests (67+ tests, updated for fixes)
forge test --match-contract OVRFLOBookTest

# Invariant tests (4 tests, 500 runs, depth 25)
forge test --match-contract OVRFLOBookInvariant -vvv

# Attack tests
forge test --match-contract OVRFLOAttackScenarios

# Flash loan tests (M-03 affects flashLoan)
forge test --match-contract OVRFLOFlashLoanTest

# Format check
forge fmt --check src/OVRFLOBook.sol src/OVRFLO.sol

# Fork tests (oracle freshness on real mainnet)
MAINNET_RPC_URL=$RPC forge test --match-path "test/fork/*"
```

**Quality gates:**
- `forge build` — zero errors, zero new warnings
- All test suites pass (unit, invariant, attack, flash loan, fork)
- `forge fmt --check` — clean on modified files
- No stale references to removed/renamed variables in `src/` or `test/`

## Definition of Done

- [ ] M-01: `claimPoolShare` removes pro-rata cap, uses `min(remaining, poolProceeds)`; minority contributor stranding regression test passes
- [ ] M-02: `createBorrowPool` checks `netToBorrower >= minAcceptable`; fee-at-max slippage test passes
- [ ] M-03: `deposit` and `flashLoan` call `_requireOracleFresh` before rate query; stale oracle reverts
- [ ] L-01: `quote` calls `_validateApr` and checks `grossPrice > 0`; invalid APR quote reverts
- [ ] L-02: `setAprBounds` requires both bounds step-aligned; non-aligned bounds revert
- [ ] All test suites pass (unit, invariant, attack, flash loan, fork)
- [ ] `forge build` clean, `forge fmt` clean
- [ ] `AUDIT_FINDINGS.md` marks all 5 findings as resolved
- [ ] Pattern docs updated if guidance changed
