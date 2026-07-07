---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
title: OVRFLOBook Cleanup - Plan
type: refactor
date: 2026-07-07
execution: code
---

# OVRFLOBook Cleanup - Plan

## Goal Capsule

- **Objective:** Remove the vestigial `poolClaimLoan` function, add documentation for non-obvious patterns, and update tests/fuzz/docs to match.
- **Product authority:** Discussion decisions: `poolClaimLoan` is a strict subset of `claimPoolShare` after the `_claimFair` refactor; harvest branch stays as defense-in-depth; immutable naming left as-is.
- **Stop conditions:** `forge build` passes; all unit, fuzz, and invariant tests pass; no new storage; no API break beyond `poolClaimLoan` removal.
- **Execution profile:** Code implementation.
- **Open blockers:** None.

## Product Contract

### Summary

Remove `poolClaimLoan` (and its `PoolLoanClaimed` event) since it is a strict subset of `claimPoolShare` after the cumulative-recovered refactor. Add documentation on four non-obvious patterns: uint128 parameter types as implicit bounds checks, the uint256/uint128 switching pattern, excess-offers early-break behavior, and the harvest branch as defense-in-depth. Update tests, fuzz properties, and docs to match.

### Problem Frame

After replacing the FCFS pool claim formula with `_claimFair`, `poolClaimLoan` and `claimPoolShare` both delegate to the same internal. The only difference is `poolClaimLoan`'s `!loan.closed` guard, which restricts rather than adds capability. `claimPoolShare` works on both open and closed loans, making `poolClaimLoan` vestigial. Separately, several non-obvious patterns in the contract need documentation in `docs/solutions/patterns/ovrflo-critical-patterns.md`: uint128 parameter types as implicit ABI-decoder bounds checks, the uint128/uint256 switching, the excess-offers early-break, and the defense-in-depth harvest branch.

### Requirements

- R1. Remove the `poolClaimLoan` external function and the `PoolLoanClaimed` event (sole emitter). Update `_claimFair` NatSpec to drop the `poolClaimLoan` reference.
- R2. Keep the harvest branch in `_claimFair` as defense-in-depth. Document in `docs/solutions/patterns/ovrflo-critical-patterns.md` explaining: (a) SP-24/SP-25 guarantee `poolProceeds >= claimable >= requestAmount`, so the harvest condition is always false under normal invariants; (b) the harvest exists as a safety net if those invariants are ever violated by future code changes.
- R3. Document in `docs/solutions/patterns/ovrflo-critical-patterns.md` that `uint128` parameter types on `createBorrowPool` (`targetBorrow`, `minAcceptable`) serve as implicit ABI-decoder bounds checks -- values exceeding `type(uint128).max` are rejected at the ABI level before any code runs.
- R4. Document in `docs/solutions/patterns/ovrflo-critical-patterns.md` the uint256/uint128 switching pattern: storage structs use uint128 for packed slots, intermediate math uses uint256 to avoid overflow on multiplication, and `_toUint128` is the overflow-checked narrowing gate.
- R5. Document in `docs/solutions/patterns/ovrflo-critical-patterns.md` the `_consumeOffers` early-break behavior: trailing offers past the break point are never touched, retaining residual capacity and active status.
- R6. Update `CONCEPTS.md` to reflect that `claimPoolShare` is the sole pool claim function, working for both open and closed loans.
- R7. Remove SP-58 (`property_poolClaimLoanDrawnIncreases`) and SP-59 (`property_poolClaimLoanProceedsUnchanged`) from `test/fizz/Properties.sol` -- they only test `poolClaimLoan` behavior. SP-60 stays (covers `claimPoolShare` conservation).
- R8. Remove `oVRFLOBook_poolClaimLoan` and `oVRFLOBook_poolClaimLoan_clamped` from `test/fizz/handlers/OVRFLOBookHandler.sol`.
- R9. Rewrite or remove tests in `test/OVRFLOBook.t.sol` that call `poolClaimLoan`. Tests verifying behavior also covered by `claimPoolShare` can be removed; tests verifying unique `poolClaimLoan` semantics (e.g., `!loan.closed` guard) become tests of `claimPoolShare` on closed loans.
- R10. Update `test/OVRFLOAttackScenarios.t.sol` `test_R17_StreamWithdrawalDuringActiveLoan` to use `claimPoolShare` instead of `poolClaimLoan`.
- R11. Update `test/fork/OVRFLOBookMainnetFork.t.sol` to use `claimPoolShare` instead of `poolClaimLoan`.
- R12. Update `PROPERTIES.md` to remove SP-58 and SP-59 entries, update "Called after" fields for SP-20, SP-23, SP-24, SP-25 (remove `poolClaimLoan`), and update SP-60's NatSpec in `test/fizz/Properties.sol` to remove the "(same as SP-59)" reference.
- R13. Update `CONCEPTS.md` and `docs/solutions/patterns/ovrflo-critical-patterns.md` to remove `poolClaimLoan` references (function descriptions, pattern context, and `rg` search command).
- R14. Update `README.md` to remove `poolClaimLoan` from the function table, code example, and prose description.

### Scope Boundaries

- Immutable naming (SCREAMING_SNAKE_CASE): out of scope (left as-is per user decision).
- `gatherOfferCapacities` double heap allocation: out of scope (view function, low priority).
- Test mock compiler warnings (MockERC20 shadowing, MockStandardizedYield purity): out of scope.
- Historical doc updates (x-ray, audit docs): out of scope (historical record).
- Removing the harvest branch from `_claimFair`: out of scope (kept as defense-in-depth per user decision).

### Key Decisions

- **Keep harvest branch as defense-in-depth.** SP-24/SP-25 guarantee `poolProceeds >= claimable` always, so the harvest is provably unreachable. But removing it means any future invariant violation surfaces as "nothing claimable" instead of a graceful fallback. The gas cost in the normal path is one comparison -- negligible. Documentation (R2) resolves auditor confusion.

- **Remove `poolClaimLoan` entirely, not just deprecate.** After the `_claimFair` refactor, it adds no capability `claimPoolShare` lacks. The `!loan.closed` guard is a restriction, not a feature. Callers who need closed-loan rejection can check `loan.closed` themselves before calling `claimPoolShare`.

- **Remove SP-58/SP-59, don't repurpose.** SP-60 already covers `claimPoolShare` conservation. SP-58/SP-59 tested `poolClaimLoan`-specific behavior (drawn delta equals poolReceived delta, poolProceeds unchanged) that no longer applies to the unified claim path.

Product Contract preservation: changed R2-R6 (NatSpec to docs), R12 (expanded "Called after" + SP-60 NatSpec), R13-R14 (added) -- doc-review findings and user direction to document in docs not NatSpec.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. Test rewriting strategy.** Twelve test functions in `test/OVRFLOBook.t.sol` call `poolClaimLoan`. Tests that duplicate `claimPoolShare` coverage (e.g., pro-rata shares, double-dip cap, book balance invariant) are removed since `claimPoolShare` already tests these via the same `_claimFair` internal. Tests that verify the `!loan.closed` guard (`test_PoolClaimLoan_ClosedLoanReverts`, `test_ClaimFair_LoanClosedPoolClaimReverts`) become positive tests of `claimPoolShare` on closed loans -- the guard was a restriction, not a feature, so the expected behavior flips from revert to success. Tests that use `poolClaimLoan` on open loans for behavior `claimPoolShare` preserves (`test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft`, `test_ClaimFair_HarvestDeficit`) are converted by swapping `poolClaimLoan` to `claimPoolShare` -- their existing assertions still hold.

- **KTD2. Documentation placement.** Pattern documentation goes in `docs/solutions/patterns/ovrflo-critical-patterns.md` rather than NatSpec in the Solidity code, per user direction. This keeps documentation in the "required reading" doc where auditors look, rather than scattered in code comments. The four patterns (R2-R5) are added as new entries following the existing format and numbering convention.

- **KTD3. SP-60 NatSpec update.** SP-60's NatSpec in `test/fizz/Properties.sol` says "(same as SP-59)" which references a property being removed (SP-59). Update to describe the property independently: "claimPoolShare: poolProceeds conservation (proceedsDecrease = receivedDelta - drawnDelta)".

- **KTD4. Handler property assertion removal.** The `oVRFLOBook_poolClaimLoan` handler calls `property_poolClaimLoanProceedsUnchanged()` (SP-59) after each call. When the handler is removed, this assertion call goes with it. No other handler calls SP-59, so no dangling references remain.

---

## Implementation Units

### U1. Remove poolClaimLoan from source

**Goal:** Remove the vestigial `poolClaimLoan` function and `PoolLoanClaimed` event from the source contract.

**Requirements:** R1

**Dependencies:** None (first unit)

**Files:** `src/OVRFLOBook.sol`

**Approach:** Remove the `poolClaimLoan` external function and the `PoolLoanClaimed` event declaration. Update the `_claimFair` `@dev` NatSpec from "Shared claim logic for `poolClaimLoan` and `claimPoolShare`" to reference only `claimPoolShare`. The `claimPoolShare` function and `_claimFair` internal are unchanged -- they already handle both open and closed loans.

**Patterns to follow:** The existing `claimPoolShare` NatSpec format and the `_claimFair` internal's documentation style.

**Test scenarios:**
- Happy path: `forge build` passes after removal with no compilation errors
- Edge case: No remaining references to `poolClaimLoan` or `PoolLoanClaimed` in `src/OVRFLOBook.sol`

**Verification:** `forge build` succeeds. `rg "poolClaimLoan|PoolLoanClaimed" src/OVRFLOBook.sol` returns no matches.

### U2. Update tests, fuzz properties, and handlers

**Goal:** Update all test code to remove `poolClaimLoan` usage, remove obsolete fuzz properties, and fix stale references.

**Requirements:** R7, R8, R9, R10, R11, R12

**Dependencies:** U1 (source must be updated first so tests compile)

**Files:** `test/fizz/Properties.sol`, `test/fizz/handlers/OVRFLOBookHandler.sol`, `test/OVRFLOBook.t.sol`, `test/OVRFLOAttackScenarios.t.sol`, `test/fork/OVRFLOBookMainnetFork.t.sol`, `PROPERTIES.md`

**Approach:**

*Properties.sol (R7, R12):* Remove `property_poolClaimLoanDrawnIncreases` (SP-58) and `property_poolClaimLoanProceedsUnchanged` (SP-59) functions. Update SP-60's NatSpec from "(same as SP-59)" to a standalone description. Keep `property_claimPoolShareReceivedIncreases` (SP-60) unchanged -- it covers `claimPoolShare` conservation.

*Handler (R8):* Remove `oVRFLOBook_poolClaimLoan` and `oVRFLOBook_poolClaimLoan_clamped` functions. Remove the `property_poolClaimLoanProceedsUnchanged()` call (it was only called from the `poolClaimLoan` handler). The `property_proRataEntitlementFloored()` call in the `claimPoolShare` handler stays.

*Unit tests (R9):* Twelve test functions call `poolClaimLoan`. Categorize each:
- Remove (duplicate `claimPoolShare` coverage): `test_PoolClaimLoan_CapsAtOutstandingAndRequiresContributor`, `test_PoolClaimLoan_AllowsMultiplePartials`, `test_PoolClaimLoan_PaysFromProceeds`, `test_PoolClaimLoan_NonContributorReverts`, `test_PoolClaimLoan_ProRataShares`, `test_PoolClaimLoan_DoubleDipCappedAtEntitlement`, `test_PoolClaimLoan_BookBalanceInvariant`, `test_PoolClaimLoan_RevertsWhenNothingClaimable` -- these verify behavior already covered by the existing `claimPoolShare` tests.
- Convert (unique `poolClaimLoan` semantics): `test_PoolClaimLoan_ClosedLoanReverts` and `test_ClaimFair_LoanClosedPoolClaimReverts` -- these tested the `!loan.closed` guard. Convert to positive tests of `claimPoolShare` on closed loans (expect success, not revert).
- Convert (open-loan calls, assertions preserved): `test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft` and `test_ClaimFair_HarvestDeficit` -- these call `poolClaimLoan` on open loans for behavior `claimPoolShare` preserves. Swap `poolClaimLoan` to `claimPoolShare`; existing assertions still hold.

*Attack scenario (R10):* Update `test_R17_StreamWithdrawalDuringActiveLoan` to use `claimPoolShare` instead of `poolClaimLoan`. The test uses `poolClaimLoan(poolId, partialRepay)` -- replace with `claimPoolShare(poolId, partialRepay)`.

*Fork test (R11):* Update `test_BookLoan_RealStreamClaimsAndCloses` to use `claimPoolShare` instead of `poolClaimLoan`. The test uses `book.poolClaimLoan(poolId, partialClaim)` -- replace with `book.claimPoolShare(poolId, partialClaim)`.

*PROPERTIES.md (R12):* Remove SP-58 and SP-59 entries. Update "Called after" fields for SP-20, SP-23, SP-24, SP-25 to remove `poolClaimLoan` (keep `claimPoolShare` and other functions).

**Patterns to follow:** Existing `claimPoolShare` test patterns in `test/OVRFLOBook.t.sol`. The converted closed-loan tests should follow the pattern of `test_ClaimPoolShare_ClaimsFromProceeds` but with a closed loan state.

**Test scenarios:**
- Happy path: All unit tests pass after rewrite (`forge test --match-contract OVRFLOBookTest`)
- Happy path: All fuzz tests pass, 1000 runs (`forge test --match-contract OVRFLOFuzz`)
- Happy path: All invariant tests pass, 500 runs (`forge test --match-contract OVRFLOBookInvariant`)
- Happy path: All attack scenario tests pass (`forge test --match-contract OVRFLOAttackScenarios`)
- Edge case: `claimPoolShare` succeeds on a closed loan (converted from `test_PoolClaimLoan_ClosedLoanReverts`)
- Edge case: `claimPoolShare` succeeds on a closed loan after partial repay (converted from `test_ClaimFair_LoanClosedPoolClaimReverts`)
- Edge case: `claimPoolShare` works in repay-then-claim-then-repay flow (converted from `test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft`)
- Edge case: `claimPoolShare` claims from proceeds without stream draw (converted from `test_ClaimFair_HarvestDeficit`)
- Edge case: Fork test compiles without `poolClaimLoan` reference
- Integration: Invariant handler no longer calls `poolClaimLoan` or SP-59 property assertion; invariant suite still passes

**Verification:** `forge build` succeeds. `forge test` passes all suites. `rg "poolClaimLoan" test/` returns no matches (except possibly in comments describing the removal). `rg "poolClaimLoan" PROPERTIES.md` returns no matches.

### U3. Update documentation

**Goal:** Add pattern documentation to the critical-patterns doc and remove `poolClaimLoan` references from all living docs.

**Requirements:** R2, R3, R4, R5, R6, R13, R14

**Dependencies:** U1 (source changes should be final before documenting)

**Files:** `docs/solutions/patterns/ovrflo-critical-patterns.md`, `CONCEPTS.md`, `README.md`

**Approach:**

*Critical-patterns doc (R2-R5, R13):* Add four new pattern entries following the existing numbering and format:
1. Harvest branch as defense-in-depth (R2): SP-24/SP-25 guarantee `poolProceeds >= claimable >= requestAmount`, so the harvest condition in `_claimFair` is always false under normal invariants. The branch exists as a safety net for future invariant violations.
2. uint128 parameter types as implicit ABI bounds checks (R3): `createBorrowPool`'s `targetBorrow` and `minAcceptable` use `uint128`, so values exceeding `type(uint128).max` are rejected at the ABI level before any code runs.
3. uint256/uint128 switching (R4): Storage structs use `uint128` for packed slots, intermediate math uses `uint256` to avoid overflow on multiplication, and `_toUint128` is the overflow-checked narrowing gate.
4. `_consumeOffers` early-break (R5): The loop breaks when `toBorrow == 0`, so trailing offers past the break point are never touched, retaining residual capacity and active status.

Also remove `poolClaimLoan` from the function list and pattern #12 context (R13). Update the `rg` search command to remove `poolClaimLoan`.

*CONCEPTS.md (R6, R13):* Update the pool claim description to reflect `claimPoolShare` as the sole pool claim function, working for both open and closed loans. Remove the `poolClaimLoan` reference from the pool description paragraph.

*README.md (R14):* Remove `poolClaimLoan` from the function table row, the code example (`book.poolClaimLoan(poolId, amount)`), and the prose description. Update the prose to describe `claimPoolShare` as the sole pool claim function.

**Patterns to follow:** Existing pattern entries in `ovrflo-critical-patterns.md` (numbered, with "Placement/Context" and description). Existing function table format in `README.md`. Existing pool description format in `CONCEPTS.md`.

**Test expectation:** none -- documentation-only changes, no behavioral code changes.

**Verification:** `rg "poolClaimLoan" CONCEPTS.md README.md docs/solutions/patterns/ovrflo-critical-patterns.md` returns no matches. Four new pattern entries are present in the critical-patterns doc. `forge build` still succeeds (no code changes).

---

## Verification Contract

**Build gate:** `forge build` must succeed after each unit.

**Unit tests:** `forge test --match-contract OVRFLOBookTest` -- all unit tests pass.

**Fuzz tests:** `forge test --match-contract OVRFLOFuzz` -- all fuzz tests pass (1000 runs).

**Invariant tests:** `forge test --match-contract OVRFLOBookInvariant -vvv` -- all invariant tests pass (500 runs, depth 25).

**Attack scenario tests:** `forge test --match-contract OVRFLOAttackScenarios` -- all attack scenario tests pass.

**Full suite:** `forge test` -- all tests pass (excluding fork tests that require `MAINNET_RPC_URL`).

**Fork test compilation:** `forge build` must succeed with the fork test file updated (fork tests run only with `--fork-url $MAINNET_RPC_URL`).

**Doc reference check:** `rg "poolClaimLoan" CONCEPTS.md README.md docs/solutions/patterns/ovrflo-critical-patterns.md PROPERTIES.md` returns no matches after all units complete.

**Source reference check:** `rg "poolClaimLoan|PoolLoanClaimed" src/OVRFLOBook.sol` returns no matches after U1.

**Test reference check:** `rg "poolClaimLoan" test/` returns no matches after U2 (except comments describing the removal, if any).

---

## Definition of Done

**Global:**
- `forge build` passes
- All unit, fuzz, invariant, and attack scenario tests pass
- No new storage variables or state changes
- No API break beyond `poolClaimLoan` and `PoolLoanClaimed` removal
- No `poolClaimLoan` or `PoolLoanClaimed` references in source, tests, or living docs
- Four new pattern entries documented in `docs/solutions/patterns/ovrflo-critical-patterns.md`
- PROPERTIES.md SP-58/SP-59 entries removed, "Called after" fields updated for SP-20/23/24/25
- SP-60 NatSpec in Properties.sol updated to remove "(same as SP-59)" reference
- Abandoned-attempt code is removed from the diff (no dead-end code left behind)

**Per-unit:**
- U1: `poolClaimLoan` function and `PoolLoanClaimed` event removed from `src/OVRFLOBook.sol`; `_claimFair` NatSpec updated
- U2: All test code updated; SP-58/SP-59 removed; handlers cleaned; tests pass
- U3: All living docs updated; four new pattern entries added; no `poolClaimLoan` references remain in docs
