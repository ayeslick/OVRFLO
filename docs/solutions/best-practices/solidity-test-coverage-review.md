---
title: Solidity test coverage review - suite audit and gap tracking
category: best-practices
module: test/
date: 2026-07-03
problem_type: best_practice
component: test_suite
severity: low
applies_when:
  - "Auditing Solidity test coverage for regression hardening"
  - "Evaluating whether CI should run Medusa/Echidna explicitly or add Foundry invariant wrappers"
  - "Locking oracle freshness, sweep guard, and APR boundary tests"
tags: [test-coverage, regression, foundry, fuzz, fork-tests, ovrflo]

---

# Solidity Test Coverage Review

## Scope

- Reviewed production Solidity scope: `src/*.sol`
- Reviewed Solidity tests: `test/**/*.sol`, including unit tests, fuzz tests, invariants, fork tests, and `test/fizz/**`
- Frontend tests were intentionally excluded from this review.

## Summary

The Solidity test suite is broad and mostly maps well to the current codebase. Core unit coverage exists for every public production contract, with focused suites for pricing math, vault flows, wrap/unwrap, flash loans, book settlement, factory admin, invariants, attack scenarios, and mainnet forks.

No critical coverage gap was found. The gaps below are mostly regression hardening and runner-integration issues.

## Accurate Coverage Observed

### `OVRFLO.sol`

- Deposits cover approval, min amount, maturity, stale oracle via `oldestObservationSatisfied == false`, slippage, no-stream-at-par, deposit limits, events, fee movement, and accounting updates.
- Claims cover full and partial redemption, unknown PT, pre-maturity, zero amount, accounting caps, and cross-market shared-token behavior.
- Wrap/unwrap coverage is strong, including donation resistance, transfer-delta checks, shared reserve consumption, zero amounts, reserve insufficiency, and underlying sweep behavior.
- Flash loan coverage is strong, including unknown PT, zero amount, paused, matured, stale oracle, wrong callback hash, failed repayment, failed fee pull, nested flash-loan reentrancy, callback composition with deposit/wrap/unwrap, exact deposited amount, max fee, rate-dependent fee, events, and fork coverage with real PTs.

### `OVRFLOBook.sol`

- Sale offer/listing flows cover posting, cancellation, slippage, dust price, fee snapshots, partial fills, capacity accounting, NFT movement, and all-party balances.
- Borrow pool coverage includes sufficient/insufficient capacity, partial coverage, self-match, duplicate IDs, market/APR mismatch, cancelled offers, fee/net slippage regressions, offer splitting between sale and loan, pool claims, pool proceeds, double-dip caps, and minority-claim regression.
- Admin coverage includes APR bound step alignment, fee/treasury updates, ownership, and multicall.
- Invariants cover obligation bounds, lender received caps, NFT return on close, and book underlying balance versus escrowed capacity.

### `StreamPricing.sol`

- Math coverage is strong. `StreamPricing.math.t.sol` and `StreamPricing.t.sol` cover known values, zero APR/time, rounding direction, overflow, obligation fast-path, residual underflow, realistic ranges, fees, eligibility reverts, and cross-market maturity mismatch.

### `OVRFLOFactory.sol` and `OVRFLOToken.sol`

- Factory deployment, duplicate underlying prevention, market onboarding, oracle readiness, owner-only forwarding, book deployment/admin forwarding, enumeration, and two-step ownership are covered.
- Token metadata, ownership transfer, mint, and burn authorization are covered.

## Gaps to Evaluate

### G-01: Fizz properties are not exercised by Foundry by default

- **Files:** `test/fizz/FoundryTester.sol`, `test/fizz/FuzzTester.sol`, `test/fizz/Properties.sol`
- **Why it matters:** `test/fizz/Properties.sol` contains many useful property checks, but `FoundryTester.test_sequence()` is empty. A normal `forge test` only runs the empty sequence, not the Medusa/Echidna stateful campaign.
- **Suggested evaluation:** Decide whether CI should run `medusa` / `echidna` explicitly, or add a Foundry invariant wrapper that exercises the Fizz handlers enough to fail when these properties regress.

### G-02: `_requireOracleFresh` does not have a cardinality-required regression test

- **Files:** `src/OVRFLO.sol`, `test/OVRFLO.t.sol`, `test/OVRFLOFlashLoan.t.sol`
- **Current coverage:** `deposit()` and `flashLoan()` revert when `oldestObservationSatisfied == false`.
- **Gap:** No test covers `getOracleState()` returning `increaseCardinalityRequired == true` while `oldestObservationSatisfied == true`.
- **Why it matters:** `OVRFLOFactory.addMarket()` rejects `increaseCardinalityRequired`, but `OVRFLO._requireOracleFresh()` currently checks only `oldestObservationSatisfied`. A test should lock the intended behavior.
- **Suggested test:** Add deposit and flash-loan tests for `(true, cardinalityRequired, true)`. If live settlement should mirror onboarding, expect revert. If only oldest observation matters after onboarding, assert success and document that distinction.

### G-03: `sweepExcessPt` missing direct unknown-PT regression

- **Files:** `src/OVRFLO.sol`, `test/OVRFLO.t.sol`, `test/OVRFLOFactory.t.sol`
- **Current coverage:** PT sweep covers non-admin, no excess, and successful excess sweep for registered PTs.
- **Gap:** There is no direct unit test that `OVRFLO.sweepExcessPt(nonPt, to)` reverts with `OVRFLO: unknown PT`.
- **Why it matters:** This guard is critical pattern #13 and prevents mis-targeted sweeps from treating unrelated token balances as excess.
- **Suggested test:** Mint underlying or an unrelated token to the vault, call `sweepExcessPt(address(unrelated), recipient)` as admin/factory owner, and expect `OVRFLO: unknown PT`.

### G-04: `prepareOracle` upper-bound guard is not directly tested

- **Files:** `src/OVRFLOFactory.sol`, `test/OVRFLOFactory.t.sol`
- **Current coverage:** `addMarket()` rejects `twapDuration > MAX_TWAP_DURATION`; `prepareOracle()` rejects durations below `MIN_TWAP_DURATION`.
- **Gap:** No direct test asserts `prepareOracle()` rejects `twapDuration > MAX_TWAP_DURATION`.
- **Why it matters:** Critical pattern #5 requires `prepareOracle` and `addMarket` bounds to stay aligned.
- **Suggested test:** Call `factory.prepareOracle(market, MAX_TWAP_DURATION + 1)` and expect `OVRFLOFactory: twap too long`.

### G-05: ID view functions lack negative tests for unknown IDs

- **Files:** `src/OVRFLOBook.sol`, `test/OVRFLOBook.t.sol`
- **Current coverage:** Positive `offerState()` and `saleListingState()` reads exist. Unknown loan is covered indirectly through `closeLoan()` and `repayLoan()`.
- **Gap:** No direct tests assert `offerState(unknown)`, `saleListingState(unknown)`, and `loanState(unknown)` revert with their expected unknown-ID messages.
- **Why it matters:** Critical pattern #8 says ID-based views must distinguish nonexistent IDs from inactive records.
- **Suggested test:** Add a view-focused test for all three unknown-ID sentinels.

### G-06: `createBorrowPool` missing direct guard coverage for several boundary reverts

- **Files:** `src/OVRFLOBook.sol`, `test/OVRFLOBook.t.sol`
- **Current coverage:** The suite covers insufficient capacity, partial coverage, self-match, market/APR mismatch, cancelled offers, duplicate IDs, and net-fee slippage.
- **Gap:** Direct tests are missing for:
  - `targetBorrow == 0` -> `OVRFLOBook: borrow zero`
  - `offerIds.length == 0` -> `OVRFLOBook: empty offers`
  - `actualBorrow > grossPrice` -> `OVRFLOBook: borrow above price`
  - `grossPrice == 0` in `createBorrowPool()` -> `OVRFLOBook: price zero`
- **Why it matters:** These are user-facing validation branches in the loan entry point and should be locked by deterministic regression tests, not only by adjacent sale/listing dust tests.

### G-07: Some pool-claim and repay edge reverts are not directly covered

- **Files:** `src/OVRFLOBook.sol`, `test/OVRFLOBook.t.sol`
- **Current coverage:** Pool claim happy paths, over-claim, non-contributor, closed-loan rejection, direct draw pro-rata shares, double-dip caps, and book-balance invariants are covered.
- **Gap:** Direct tests are missing for:
  - `claimPoolShare(poolId, 0)` -> `OVRFLOBook: claim zero`
  - `repayLoan()` with outstanding already reduced to zero by `claimPoolShare()` harvesting but before `closeLoan()` -> `OVRFLOBook: nothing outstanding`
- **Why it matters:** These guard branches are small, but deterministic tests make future refactors safer.

### G-08: Fork tests require `MAINNET_RPC_URL` and are not self-skipping

- **Files:** `test/fork/*.t.sol`
- **Current behavior:** `OVRFLOForkBase.setUp()` calls `vm.envString("MAINNET_RPC_URL")`.
- **Why it matters:** A full `forge test` run without that environment variable fails instead of skipping fork suites. This can make local and CI results look like test failures rather than missing fork configuration.
- **Suggested evaluation:** Either document the required command split (`forge test --no-match-path "test/fork/*"` for local fast checks, fork tests only with `MAINNET_RPC_URL`) or add a skip pattern if the env var is absent.

## Suggested Priority

1. Add G-02, G-03, and G-04. These lock recently important oracle/sweep/oracle-prep security guards.
2. Add G-05 and G-06. These cover public ABI edge behavior and loan boundary regressions.
3. Decide how to run G-01 and G-08 in CI. These are runner/process gaps rather than missing unit assertions.
4. Add G-07 opportunistically when touching pool servicing tests.
