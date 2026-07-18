---
title: Solidity hot-path optimization - cache external calls, extract pricing helpers, remove dead state
date: 2026-07-13
category: docs/solutions/best-practices/
module: src/ (OVRFLO, OVRFLOLending, OVRFLOFactory, StreamPricing)
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - "Refactoring Solidity hot paths where external calls or storage reads repeat within a single function"
  - "Extracting repeated multi-line patterns (rate lookup, pricing, TWAP bounds) into internal helpers"
  - "Auditing structs for dead fields that are populated but never read by any caller"
  - "Replacing hand-rolled numeric casts with audited OpenZeppelin SafeCast primitives"
  - "Reordering cheap storage-only validation before expensive external calls to fail fast"
tags: [gas-optimization, caching, external-calls, sload, helper-extraction, dead-code, safecast, storage-pointer, fail-fast, solidity]
---

# Solidity hot-path optimization - cache external calls, extract pricing helpers, remove dead state

## Context

Two refactoring passes on `src/*` (OVRFLO, OVRFLOLending, OVRFLOFactory, StreamPricing) identified and fixed 10 issues across code reuse, code quality, and efficiency. The project is a Foundry-based Solidity DeFi protocol using OpenZeppelin. The passes used parallel code-reuse, code-quality, and efficiency reviewers to systematically find opportunities.

## Guidance

Seven patterns were applied:

**1. Cache external call results in hot paths**

`_claimFair` (the claimLoanPoolShare internal logic) called `sablier.withdrawableAmountOf(streamId)` twice, once to compute `recovered` and again to compute `harvestAmount`. No state changed between calls. Caching in a local saved one external call (~2600 gas warm):

```solidity
// Before: two external calls
recovered += _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan));
// ... later ...
harvestAmount = _minUint128(..., _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan)));

// After: one external call, cached
uint128 withdrawable;
uint128 outstanding;
if (!loan.closed) {
    outstanding = _outstanding(loan);
    withdrawable = sablier.withdrawableAmountOf(loan.streamId);
    recovered += _minUint128(withdrawable, outstanding);
}
// ... later, reuse cached values ...
harvestAmount = _minUint128(..., _minUint128(withdrawable, outstanding));
```

Similarly, `loanPoolProceeds[loanId]` was accessed 5 times (2 reads, 2 writes, 1 read-write in harvest path). Caching in a local `proceeds` variable reduced to 1 SLOAD + 1 SSTORE:

```solidity
uint128 proceeds = loanPoolProceeds[loanId];
// ... all arithmetic on local ...
loanPoolProceeds[loanId] = proceeds - payAmount; // single write-back
```

**2. Cache storage reads in locals**

`loan.streamId` was SLOAD'd 3x in `closeLoan` (withdrawableAmountOf, withdraw, transferFrom). Caching in a local `streamId` saved 2 redundant warm SLOADs (~200 gas). Same pattern for `ptToMarket[ptToken]` in `sweepExcessPt`.

**3. Extract repeated patterns into helpers**

Three patterns were extracted:
- `_approvedRate(market)` — the 4-line series-load + approved-check + oracle-fresh + rate-fetch pattern appeared 3x in OVRFLO preview functions (and was later routed through `deposit` as well in the 2026-07 simplification refactor's U6)
- `_priceStream(market, streamId, aprBps)` — the 3-step eligibility + grossPrice + zero-check pattern appeared 4x in OVRFLOLending fill/quote functions. Returns `(Eligibility, grossPrice, timeToMaturity)` so callers that need timeToMaturity for obligation calculation don't need a separate call
- `_validateTwapBounds(twapDuration)` — TWAP duration bounds check appeared 2x in OVRFLOFactory with reversed check ordering (minor inconsistency). Extracting fixed the inconsistency

**4. Remove dead struct fields**

`Eligibility.ovrfloToken` was set by `requireEligible` but never read by any caller (verified via grep across src/ and test/). The field wasted a memory slot in the struct on every eligibility check. Removed from struct definition and assignment.

**5. Use audited OZ primitives**

`_toUint128` hand-rolled `require(amount <= type(uint128).max, "OVRFLOLending: uint128 overflow")` then `uint128(amount)`. Replaced body with `SafeCast.toUint128(amount)` — behavior-identical, audited. The wrapper function was kept to preserve the internal API and test harness; only the body changed. Test updated to expect SafeCast's revert string.

**6. Use storage pointers over memory copies for partial reads**

`flashLoan` used `SeriesInfo memory info = _series[market]` which copies all 3 storage slots into memory. But the function only accessed `info.expiryCached` (slot 1) and `info.twapDurationFixed` (slot 0) — never `info.ptToken` (slot 2). Changing to `SeriesInfo storage info` makes the compiler only SLOAD accessed slots, skipping slot 2.

**7. Reorder cheap validation before expensive external calls**

`createBorrowerLoanPool` ran `_requireEligible` (at the time, 10+ external calls to Sablier for stream getters, factory for registry, vault for series info) before `_validateLiquidity` (pure storage-read loop). Reordering to validate liquidity first fails fast on invalid positions, saving ~26k gas on the error path. Both are view functions, so CEI (checks-effects-interactions) ordering is preserved. (Note: the 2026-07 simplification refactor's U5 later collapsed the 8 Sablier getter calls into a single `getStream` struct return, and U4 removed the `factory.isMarketApproved` external call, so the current call count is much lower — but the fail-fast ordering principle remains the right call.)

## Why This Matters

Gas optimization in Solidity is not just about reducing opcodes — it's about avoiding unnecessary state access. External calls cost ~2600 gas (warm) per call. Storage reads cost 100 gas (warm) per SLOAD. In hot paths like `_claimFair` (called on every pool claim) and `closeLoan` (called on every loan close), eliminating redundant calls and SLOADs compounds across thousands of transactions.

Extracting repeated patterns into helpers has a dual benefit: it reduces code duplication (easier to maintain) and ensures consistency (a bug fix in the helper propagates to all call sites). The `_priceStream` helper, for example, ensures all 4 pricing paths apply the same eligibility check and zero-guard.

## When to Apply

- When a function makes the same external call twice with no state change between calls
- When a storage variable is read more than once in the same function
- When a 3+ line pattern appears 3+ times across different functions
- When a struct field is populated but never read by any consumer
- When a hand-rolled utility duplicates an audited library function (SafeCast, SafeERC20, etc.)
- When a function copies a struct to memory but only reads some fields
- When expensive external calls could be preceded by cheaper validation

## Examples

**Before (redundant external call in _claimFair):**
```solidity
recovered += _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan));
// ... 10 lines later ...
harvestAmount = _minUint128(..., _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan)));
```

**After (cached):**
```solidity
uint128 withdrawable;
uint128 outstanding;
if (!loan.closed) {
    outstanding = _outstanding(loan);
    withdrawable = sablier.withdrawableAmountOf(loan.streamId);
    recovered += _minUint128(withdrawable, outstanding);
}
// ... harvestAmount reuses cached `withdrawable` and `outstanding` ...
```

**Before (4x repeated pricing pattern):**
```solidity
StreamPricing.Eligibility memory eligibility = _requireEligible(market, streamId);
uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
require(grossPrice > 0, "OVRFLOLending: price zero");
```

**After (extracted helper):**
```solidity
(eligibility, grossPrice, timeToMaturity) = _priceStream(market, streamId, aprBps);
```

## Related

- [Avoid unnecessary type widening](./avoid-unnecessary-type-widening-with-invariant-guarantees.md) - Sibling doc on dead-helper removal and SafeCast reasoning for arithmetic
- [Factory deployment admin pattern](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md) - Documents one specific SLOAD-to-immutable conversion; this learning generalizes storage-read caching
- [Offer market-active gate](../architecture-patterns/ovrflobook-offer-market-active-gate.md) - Eligibility-check helper extraction and no-hot-path-gas-regression guarantee
- [Entry teardown: zero what matters](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md) - Complementary tension on dead state: runtime slot-zeroing cost vs compile-time dead-state deletion
- [Behavior-preserving simplification refactor](../architecture-patterns/behavior-preserving-simplification-refactor.md) - The larger multi-commit sequel applying these patterns at broader scope (U5 collapsed 8 Sablier getters to 1 `getStream`, U6 extracted `_freshRate`/`_approvedRate`, U7 replaced hand-rolled ceil with `Math.mulDiv(Rounding.Up)`)
