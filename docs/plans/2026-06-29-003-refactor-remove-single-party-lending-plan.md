---
title: "Remove Single-Party Lending - Plan"
type: refactor
date: 2026-06-29
topic: remove-single-party-lending
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Remove Single-Party Lending - Plan

## Goal Capsule

- **Objective:** Remove single-party lending functions from OVRFLOBook so pools are the only lending/borrowing mechanism. Sale offers/listings remain for active trading.
- **Product authority:** User-directed design decision; confirmed via brainstorm dialogue.
- **Open blockers:** None. All key decisions resolved.
- **Execution profile:** Code. Standard depth, deletion-focused refactor.
- **Tail ownership:** Implementer owns commit/PR. User reviews before merge.

---

## Product Contract

### Summary

Remove `borrowAgainstOffer`, `lendAgainstListing`, and `claimLoan` from OVRFLOBook. Pools become the only lending/borrowing path. `closeLoan` and `repayLoan` simplify by dropping the non-pool branch. Sale offers/listings remain untouched.

### Problem Frame

OVRFLOBook currently has three modes: active sales (bilateral stream trading), passive pools (aggregated lending), and single-party lending (bilateral loans via direct offer/listing matching). The single-party lending functions are an awkward middle ground — they use active matching (you pick a specific counterparty) but for lending rather than selling. With the sale market covering the active case and pools covering the passive case, the single-party path adds code surface, branching logic in `closeLoan`/`repayLoan`, and a separate claiming mechanism (`claimLoan` vs `poolClaimLoan`/`claimPoolShare`) without serving a distinct user need.

### Key Decisions

- **Pools are the only lending mechanism.** Single-party functions are removed entirely. A pool of 1 covers the bilateral case with the same claiming flow as any pool, avoiding two code paths for the same economic outcome.
- **Sale market untouched.** `postSaleOffer`, `postSaleListing`, `matchSaleOffer`, `matchSaleListing` remain as-is for sophisticated users who want active bilateral stream trading.
- **All loans are pool loans.** `closeLoan` and `repayLoan` drop the `loanPoolId == 0` branch and always route through `poolProceeds`. No more branching on loan type.

### Requirements

**Functions removed**

- R1. Remove `borrowAgainstOffer` function and `BorrowedAgainstOffer` event from `src/OVRFLOBook.sol`.
- R2. Remove `lendAgainstListing` function and `LentAgainstListing` event from `src/OVRFLOBook.sol`.
- R3. Remove `claimLoan` function and `LoanClaimed` event from `src/OVRFLOBook.sol`.

**Functions simplified**

- R4. `closeLoan` always routes outstanding draws to `poolProceeds[poolId]` (remove the `else` branch that withdraws directly to `loan.lender`).
- R5. `repayLoan` always pulls repayment to `address(this)` and adds to `poolProceeds[poolId]` (remove the `else` branch that pulls to `loan.lender`).

**Functions unchanged**

- R6. Lend offer posting (`postLendOffer`, `cancelLendOffer`) and borrow listing posting (`postBorrowListing`, `cancelBorrowListing`) remain unchanged. These are the passive entry points that pools match against.
- R7. Pool functions (`createBorrowPool`, `createLenderPool`, `poolClaimLoan`, `claimPoolShare`) remain unchanged.
- R8. Sale functions (`postSaleOffer`, `postSaleListing`, `matchSaleOffer`, `matchSaleListing`, `cancelSaleOffer`, `cancelSaleListing`) remain unchanged.

**Tests and documentation**

- R9. Update `test/OVRFLOBook.t.sol` to remove all single-party lending test cases and redirect coverage to pool equivalents where the scenario is still meaningful.
- R10. Update `test/OVRFLOBookInvariant.t.sol` to remove single-party handlers from invariant fuzzing.
- R11. Update `test/OVRFLOAttackScenarios.t.sol` to remove attack scenarios targeting single-party lending paths.
- R12. Update `test/fork/OVRFLOBookMainnetFork.t.sol` to remove fork tests using single-party functions.
- R13. Update documentation referencing single-party lending (`CONCEPTS.md`, `README.md`, `AUDIT.md`, `docs/solutions/` writeups, `x-ray/` reports) to reflect pools-only lending.

### Scope Boundaries

**Outside this product's identity**

- Changes to pool mechanics (pro-rata math, `poolProceeds` tracking, contribution accounting).
- Changes to sale market mechanics (offer/listing matching, pricing).
- Changes to deposit flow, wrap/unwrap, or Sablier stream structure.
- Gas optimization for the pool-of-1 case (acceptable overhead, not worth special-casing).

Product Contract unchanged.

### Sources / Research

- `src/OVRFLOBook.sol` — current implementation of single-party functions (`borrowAgainstOffer` at ~line 605, `lendAgainstListing` at ~line 710, `claimLoan` at ~line 761) and branching in `closeLoan` at ~line 797 and `repayLoan` at ~line 840.
- `test/OVRFLOBook.t.sol` — single-party test cases spanning `test_BorrowAgainstOffer_*`, `test_LendAgainstListing_*`, `test_ClaimLoan_*`, self-match reverts, non-pool branch tests, and the `_originateLoanViaOffer` helper used by ~15 additional tests.
- `test/OVRFLOBookInvariant.t.sol` — 3 invariant handlers (`borrowAgainstOffer` at line 388, `lendAgainstListing` at line 433, `claimLoan` at line 452).
- `test/OVRFLOAttackScenarios.t.sol` — 2 references to single-party functions in attack scenarios (line 516, 528).
- `test/fork/OVRFLOBookMainnetFork.t.sol` — 4 references across fork tests (lines 60, 70, 96, 189).
- `docs/solutions/patterns/ovrflo-critical-patterns.md` — pattern #4 (self-match prevention) references `borrowAgainstOffer` and `lendAgainstListing`; pattern #12 (pro-rata cap) references `poolClaimLoan` gas comparison.
- `CONCEPTS.md` — Pool entry at line 101 references `borrowAgainstOffer` and `lendAgainstListing` as batch primitives.
- Pre-launch: no deployed contracts, no migration path needed.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Remove functions and events atomically with test updates.** The 3 functions, 3 events, and all test references must change in one unit. Removing functions without updating tests breaks compilation, and updating tests without removing functions leaves dead code. U1 handles both together.

- KTD2. **`closeLoan` and `repayLoan` drop the `loanPoolId == 0` guard.** Every loan created by `createBorrowPool` or `createLenderPool` has `loanPoolId[loanId] != 0`. After removing single-party functions, no loan can exist with `loanPoolId == 0`. The branching in `closeLoan` (lines ~797-800) and `repayLoan` (lines ~840-843) collapses to the pool path only. The `require(loanPoolId[loanId] == 0, "OVRFLOBook: use poolClaimLoan")` guard in the now-removed `claimLoan` disappears with the function.

- KTD3. **Test redirect strategy.** Single-party test scenarios that test general loan behavior (self-match prevention, fee snapshot, obligation drift, slippage) have direct pool equivalents and should be redirected. Scenarios testing `claimLoan`-specific mechanics (direct lender stream draw, pool-loan rejection in `claimLoan`) are removed since the function no longer exists. The `test_ClaimLoan_PoolLoanReverts` test is removed entirely — its assertion is now vacuously true.

- KTD4. **`_storeLoan` is never called with `loan.lender != address(this)`.** After removing single-party functions, all loans are created via pool functions which set `loan.lender = address(this)`. The `lender` field in the `Loan` struct remains for event emission and `closeLoan`/`repayLoan` references, but it is always the book contract address for pool loans. No structural change to `Loan` is needed.

### Sequencing

U1 (contract + unit tests) must land first — it removes the functions and updates the primary test file. U2 (invariant, attack, fork tests) depends on U1 for compilation. U3 (documentation) can run in parallel with U2 but is sequenced last for cleanliness.

---

## Implementation Units

### U1. Remove single-party functions and simplify loan servicing

- **Goal:** Delete `borrowAgainstOffer`, `lendAgainstListing`, `claimLoan` and their events from `src/OVRFLOBook.sol`. Simplify `closeLoan` and `repayLoan` to remove the non-pool branch. Update `test/OVRFLOBook.t.sol` to remove single-party test cases.
- **Requirements:** R1, R2, R3, R4, R5, R9
- **Dependencies:** None
- **Files:**
  - `src/OVRFLOBook.sol` (modify)
  - `test/OVRFLOBook.t.sol` (modify)
- **Approach:** Remove the three function bodies and their event declarations. In `closeLoan`, delete the `if (poolId != 0) { ... } else { ... }` branch and keep only the pool path (withdraw to `address(this)`, add to `poolProceeds[poolId]`). In `repayLoan`, same — keep only the pool path (pull to `address(this)`, add to `poolProceeds[poolId]`). Remove `BorrowedAgainstOffer`, `LentAgainstListing`, and `LoanClaimed` events. Update NatSpec comments on the `Loan` struct, `Pool` struct, `postLendOffer`, and `loanPoolId` mapping that reference removed functions. In the test file, remove single-party test functions (`test_BorrowAgainstOffer_*`, `test_LendAgainstListing_*`, `test_ClaimLoan_*`, `test_CloseLoan_NonPoolTransfersToLender`, `test_RepayLoan_NonPoolTransfersToLender`, `test_Pool_LoanPoolIdDefaultsToZero`). Rewrite the `_originateLoanViaOffer` helper to use `createBorrowPool` instead of `borrowAgainstOffer` (e.g., `_originateLoanViaBorrowPool`). Update all tests that use this helper (`test_CloseLoan_*`, `test_RepayLoan_*`, `test_PoolClaimLoan_BookBalanceInvariant`, `test_Quote_EqualsLoanSettlementAndLoanStateReflectsRepayment`) to use the rewritten helper and update assertions: pool-path repayment routes to `poolProceeds` not `loan.lender`, and `claimLoan` setup steps become `poolClaimLoan`. Redirect self-match and fee-snapshot scenarios to pool equivalents if coverage is meaningful.
- **Patterns to follow:** Existing pool test patterns in `test/OVRFLOBook.t.sol` for `createBorrowPool` and `createLenderPool` tests.
- **Test scenarios:**
  - Happy path: `createBorrowPool` with single offer originates loan, `poolClaimLoan` draws from stream, `claimPoolShare` withdraws proceeds (replaces `borrowAgainstOffer` + `claimLoan` flow)
  - Happy path: `createLenderPool` with single listing originates loan (replaces `lendAgainstListing` flow)
  - Edge case: `closeLoan` on pool loan routes outstanding to `poolProceeds`, stream returned to borrower
  - Edge case: `repayLoan` on pool loan pulls to `address(this)`, adds to `poolProceeds`, stream returned on full repayment
  - Error path: self-match prevention in `createBorrowPool` (borrower is an offer maker) — redirect from `test_BorrowAgainstOffer_RevertsForSelfMatch`
  - Error path: self-match prevention in `createLenderPool` (lender is a listing borrower) — redirect from `test_LendAgainstListing_RevertsForSelfMatch`
  - Integration: fee snapshot in `createLenderPool` protects borrower from later fee changes — redirect from `test_LendAgainstListing_UsesSnapshottedFeeWhenGlobalFeeChanges`
- **Verification:** `forge build` succeeds. `forge test --match-contract OVRFLOBookTest` passes with no references to removed functions.

### U2. Update invariant, attack scenario, and fork tests

- **Goal:** Remove single-party handlers and scenarios from invariant, attack, and fork test suites.
- **Requirements:** R10, R11, R12
- **Dependencies:** U1
- **Files:**
  - `test/OVRFLOBookInvariant.t.sol` (modify)
  - `test/OVRFLOAttackScenarios.t.sol` (modify)
  - `test/fork/OVRFLOBookMainnetFork.t.sol` (modify)
- **Approach:** In `OVRFLOBookInvariant.t.sol`, remove the `borrowAgainstOffer` (line 388), `lendAgainstListing` (line 433), and `claimLoan` (line 452) handler functions from the handler contract. The fuzzer targets all public functions via `targetContract`, so no selector array update is needed. In `OVRFLOAttackScenarios.t.sol`, update the attack scenario at lines 516/528 to use `createBorrowPool` with a single offer instead of `borrowAgainstOffer`, or remove the scenario if it only tests single-party mechanics. In `OVRFLOBookMainnetFork.t.sol`, update the 4 references (lines 60, 70, 96, 189) to use pool functions. Note that fork test assertions must also change: `claimLoan` direct-to-lender draws become `poolClaimLoan` draws to the caller, and `repayLoan` assertions checking `loan.lender` balance must check `poolProceeds` and use `claimPoolShare` instead.
- **Patterns to follow:** Existing pool handler patterns in `OVRFLOBookInvariant.t.sol` for `createBorrowPool` and `createLenderPool` handlers.
- **Test scenarios:**
  - Happy path: invariant tests pass with pool-only handlers (500 runs, depth 25)
  - Happy path: attack scenario using pool path demonstrates same griefing protection
  - Happy path: fork test using `createBorrowPool` with live Pendle market succeeds
  - Integration: invariant `totalObligationSatisfied` holds without single-party loan paths
- **Verification:** `forge test --match-contract OVRFLOBookInvariant` passes (500 runs, depth 25). `forge test --match-contract OVRFLOAttackScenarios` passes. Fork tests pass with `$MAINNET_RPC_URL`.

### U3. Update documentation

- **Goal:** Remove references to single-party lending functions from all documentation and audit artifacts.
- **Requirements:** R13
- **Dependencies:** U1 (for accuracy — docs should reflect the implemented state)
- **Files:**
  - `CONCEPTS.md` (modify)
  - `README.md` (modify)
  - `AUDIT.md` (modify)
  - `CLAUDE.md` (modify)
  - `docs/solutions/patterns/ovrflo-critical-patterns.md` (modify)
  - `docs/solutions/README.md` (modify)
  - `docs/solutions/best-practices/verify-token-balance-movement-not-just-ownership.md` (modify)
  - `docs/solutions/architecture-patterns/ovrflobook-offer-market-active-gate.md` (modify)
  - `docs/solutions/architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md` (modify)
  - `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md` (modify)
  - `x-ray/entry-points.md` (modify)
  - `x-ray/invariants.md` (modify)
  - `x-ray/x-ray.md` (modify)
  - `x-ray/multi-agent-audit-report.md` (modify)
- **Approach:** In `CONCEPTS.md` line 101, update the Pool entry to describe pools as the only lending mechanism rather than referencing `borrowAgainstOffer` and `lendAgainstListing` as batch primitives. In `ovrflo-critical-patterns.md`, update pattern #4 (self-match) to reference pool function self-match guards instead of single-party functions. Update the function list in the audit grep command. In `x-ray/` reports, remove single-party functions from entry-point listings and invariant descriptions. Scan `README.md` and `AUDIT.md` for references and update.
- **Test expectation:** none — documentation-only unit.
- **Verification:** `rg -l "borrowAgainstOffer|lendAgainstListing|claimLoan[^P]"` returns no hits in `src/`, `test/`, `docs/`, `x-ray/`, `CONCEPTS.md`, `README.md`, `AUDIT.md`.

---

## Verification Contract

| Gate | Command | Scope |
|------|---------|-------|
| Build | `forge build` | All contracts compile |
| Unit tests | `forge test --match-contract OVRFLOBookTest` | U1 — unit tests pass |
| Invariant tests | `forge test --match-contract OVRFLOBookInvariant` | U2 — 500 runs, depth 25 |
| Attack scenarios | `forge test --match-contract OVRFLOAttackScenarios` | U2 — attack tests pass |
| Fork tests | `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` | U2 — fork tests pass |
| Full suite | `forge test` | All non-fork tests pass |
| Format | `forge fmt` | Solidity formatting clean |
| No stale refs | `rg "borrowAgainstOffer|lendAgainstListing|claimLoan[^P]"` | U3 — no hits in src, test, docs |

---

## Definition of Done

- All three single-party functions and their events are removed from `src/OVRFLOBook.sol`
- `closeLoan` and `repayLoan` have no `loanPoolId == 0` branch
- All 4 test files compile and pass without referencing removed functions
- Invariant tests pass at 500 runs, depth 25
- Fork tests pass against real Pendle mainnet
- Documentation has no stale references to single-party lending
- `forge build`, `forge test`, and `forge fmt` all succeed
- No dead code or commented-out blocks left from the removal
