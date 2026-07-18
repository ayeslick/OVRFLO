---
title: Behavior-preserving simplification of OVRFLO contracts - vestigial state deletion, struct-return consolidation, and audited-math replacement
date: 2026-07-18
category: docs/solutions/architecture-patterns/
module: src/ (OVRFLO, OVRFLOLending, OVRFLOFactory, StreamPricing, OVRFLOToken)
problem_type: architecture_pattern
component: development_workflow
severity: low
applies_when:
  - "Planning a behavior-preserving simplification refactor of a Solidity protocol split into multiple implementation units across separate commits"
  - "Consolidating redundant state (duplicate mappings, counters, struct fields, derived booleans, parallel registries) without changing external behavior"
  - "Collapsing several external getter calls into one struct-returning call and verifying the nested struct ABI against the deployed mainnet contract"
  - "Replacing hand-rolled math (ceil div, integer casts) with OpenZeppelin Math.mulDiv and SafeCast, proved by a differential fuzz test"
  - "Running a multi-unit refactor with forge build + forge test gates between units and fuzz/invariant/mainnet-fork coverage as the behavior-preservation gate"
tags: [behavior-preserving-refactor, vestigial-state, gas-optimization, abi-verification, sablier-getstream, openzeppelin-math, dead-code-removal, revert-ordering]
---

# Behavior-preserving simplification of OVRFLO contracts - vestigial state deletion, struct-return consolidation, and audited-math replacement

## Context

OVRFLO is a Foundry-based Solidity protocol: a Pendle basket vault (`OVRFLO`) that wraps PT deposits into `ovrfloToken` and streams yield via Sablier V2, plus a secondary lending market (`OVRFLOLending`) for trading and lending against those streams. Like most protocols that grew organically under deadline pressure, the contracts had accumulated layers of vestigial state and redundant work that were correct but expensive and hard to reason about:

- **Duplicate ABI wrapper getters** in `OVRFLOLending` (`loanState`, `liquidityState`, `saleListingState`) and `OVRFLOFactory` (`getOvrfloInfo`, `getApprovedMarket`) that just re-shaped data the compiler's auto-getters already exposed.
- **A dual ID space** for loans and loan pools, with three translation maps (`nextLoanPoolId`, `loanToLoanPool`, `loanPoolLoanId`) and two redundant struct fields (`Loan.lender`, `LoanPool.totalObligation`) carrying information recoverable from a single counter.
- **A derived boolean** (`LiquidityPosition.active`) that duplicated the signal already carried by `availableLiquidity > 0`, plus a `SeriesInfo.approved` field backing a dual market-approval registry that duplicated the `ptToken != address(0)` sentinel.
- **Eight individual Sablier getter calls** inside `requireEligible` to reassemble a `Stream` that Sablier's own `getStream()` returns in one call, but the interface didn't model `getStream` and nobody had verified the deployed struct shape.
- **Hand-rolled ceil** (`PRBMath.mulDiv` + `mulmod != 0 ? +1`) and a **manual uint128 overflow check + raw cast** that duplicated `OpenZeppelin.Math.mulDiv(Rounding.Up)` and `SafeCast.toUint128`.
- **Dead parameters** (`factory` in `marketActive`/`requireEligible`) that outlived both the `isMarketApproved` external call and the `CoreNotRegistered` check they were originally threaded in to support.

None of this was a bug. All of it was attack surface, gas, and cognitive load. The prompt for this refactor was a deliberate "shrink the contract" pass: identify everything the protocol was carrying that it did not need, delete it without changing behavior, and prove the deletion was safe.

The work was structured as a **4-agent review process** that produced 9 findings, executed as **8 implementation units across 3 commits** (vestigial state deletion, gas optimization, math consolidation), followed by an **11-reviewer code review** that surfaced no P0/P1 findings, empirically verified the security-critical `getStream` field mapping against live mainnet Sablier, and produced 5 behavior-preserving fixes plus a cosmetic tidy-up pass.

## Guidance

The methodology that made this refactor safe rather than adventurous:

### 1. Use a multi-agent review pass to find deletion candidates, then sequence them

A single reviewer reading a familiar contract rationalizes what they remember, not what is there. Splitting the audit into focused reviewer roles (code-reuse, code-quality, efficiency, security) and running them in parallel surfaced 9 findings that a single pass would have merged or missed. Findings were then sequenced into self-contained implementation units ordered so that each unit's blast radius was testable in isolation: state-shape changes first (U1-U4), call-pattern changes next (U5, U8), math last (U6, U7). Math last matters, arithmetic changes are the easiest to get subtly wrong and the easiest to prove with a differential fuzz test, so they go at the end when the rest of the contract is already stable.

### 2. Verify deployed contract ABIs empirically before writing interface structs

Docs, memory, and even the upstream repo's current `interface/` folder are unreliable sources for the exact shape of a struct returned by a deployed contract. Before modeling `ISablierV2LockupLinear.getStream` and its nested `Amounts` sub-struct, the deployed mainnet contract (`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`) was probed directly:

```bash
cast call 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9 \
  "getStream(uint256)(...)" <streamId> --rpc-url $MAINNET_RPC_URL
```

The returned word layout (13 words, with the `Amounts` sub-struct packed inside) was decoded against the live return, and the security-critical `isCancelable` field position was cross-checked by calling the 7 individual getters Sablier also exposes and reconciling the values on real cancelable streams (IDs 50 and 10). Only after the empirical shape matched the proposed interface were the `Stream` and `Amounts` structs added to `ISablierV2LockupLinear`. **The `isCancelable` field mapping is security-critical for OVRFLO: a misaligned `isCancelable` would let a cancelable stream be pledged mid-loan, breaking the lender's stream-draw recourse.** Empirical verification, not doc-reading, is what made this safe.

### 3. Behavior-preserving does not mean revert-ordering-preserving

A "behavior-preserving" refactor preserves the set of (input -> output/state) tuples, not the exact revert a caller sees. When `deposit` was routed through `_approvedRate` (U6), the oracle-freshness check moved before the amount/maturity checks. A call with a stale oracle and a bad amount now reverts on the oracle check instead of the amount check. That is a different observable revert string, even though no valid call was broken and no invalid call was newly accepted. Tests that asserted on exact revert reasons (rather than revert *fact*) had to be updated. When planning a behavior-preserving refactor, enumerate the revert-ordering changes explicitly and audit any test that asserts revert strings.

### 4. Delete vestigial state by proving every consumer is gone, then update destructures mechanically

Each deletion (U1-U4) followed the same drill: grep every read of the field/mapping across `src/` and `test/`, prove no production path depends on it, delete the declaration, then fix the mechanical fallout. The fallout is predictable and large:

- **U1 (Loan/LoanPool single ID space):** ~249 references across 9 files, ~10 fuzz properties reworked.
- **U2 (drop `LiquidityPosition.active`):** 4 `require(liquidity.active)` replaced with `require(liquidity.availableLiquidity > 0)`, 3 `active = false` writes removed, ~40 destructures shrunk 5 -> 4 fields.
- **U4 (drop dual market-approval registry):** `SeriesInfo.approved` deleted, `SeriesNotApproved` error deleted, `series()` return shrunk 8 -> 7 fields across ~17 destructures, approval gate changed to `ptToken != address(0)`.

The destructure-count metric (~40, ~17) is the real cost of these deletions and the reason they get deferred: the saving is permanent and the pain is one-time, but the pain is real and visible while the saving is diffuse. Budget for the destructure sweep; do not attempt it without grep-verified proof of no remaining consumers.

### 5. Replace N getters with one struct-return call, then keep mocks in lockstep

`requireEligible` made 8 individual Sablier calls (`streamedAmountOf`, `withdrawableAmountOf`, `recipient`, `sender`, `startTime`, `endTime`, `isCancelable`, `cancelable`) to reassemble what `getStream` returns in one call. Replacing them with a single `getStream` cut ~5-10k gas per eligibility check. The trap is the mock: `MockLendingSablier` had its own `StreamView`/`AmountsView` structs that had drifted from the interface `Stream`/`Amounts`. Duplicating a struct in a mock is a **silent-divergence trap**, tests pass against the mock's shape and fail (or worse, pass wrongly) against mainnet. After U5, both `MockSablier` and `MockLendingSablier` were updated to implement the interface `getStream` directly, and the divergent view structs were removed. Rule: mocks implement the interface, they do not redeclare it.

### 6. Replace hand-rolled math with audited primitives, prove equivalence with a differential fuzz test

Two math replacements in U7:

```solidity
// Before: hand-rolled ceil
uint256 result = PRBMath.mulDiv(amount, factor, denominator);
if (mulmod(amount, factor, denominator) != 0) result += 1;

// After: audited OpenZeppelin
uint256 result = Math.mulDiv(amount, factor, denominator, Math.Rounding.Up);
```

```solidity
// Before: manual overflow check + raw cast
require(amount <= type(uint128).max, "OVRFLOLending: uint128 overflow");
uint128 casted = uint128(amount);

// After: audited SafeCast
uint128 casted = SafeCast.toUint128(amount);
```

Equivalence was proved with a **differential fuzz test** that ran the old expression and the new expression on the same random inputs and asserted equality across 1000 runs. For arithmetic refactors, a differential fuzz is the minimum bar, unit tests on a few hand-picked values do not catch the off-by-one at the rounding boundary that only fires on inputs where `mulmod` is barely nonzero.

### 7. Extract helpers for repeated patterns, and watch the gas regression

U6 extracted `_freshRate(market)` for the oracle-fresh + rate-read pattern and `_approvedRate(market)` for the approval-check + oracle-fresh + rate-read pattern, routing `deposit` through `_approvedRate` and `flashLoan` through `_freshRate`. The first cut declared the helper parameter as `SeriesInfo memory`, which copied all three storage slots into memory on every call, a net gas regression versus the inlined version. The fix was to narrow the parameter to `uint32 twapDurationFixed` so the helper only touched the slot it needed. **Helper extraction is not automatically a gas win; if the helper takes a memory struct where a scalar would do, you've just added a copy.** Always diff gas before/after an extraction.

### 8. Use helper extraction for stack-too-deep, not compiler flags

OVRFLO builds with `via_ir = false`. When fork tests grew a `loanState` destructure tall enough to hit `stack too deep`, the fix was not to flip `via_ir` on (which would have changed the whole project's compilation model and gas) but to extract a `_loanOutstanding(loanId)` helper that pulled the deep computation out of the stack frame. In `via_ir = false` projects, helper extraction is the correct tool for stack-too-deep; compiler flags are a project-wide change with project-wide consequences.

### 9. Auto-getters return zeros, not reverts, for uninitialized slots

When U3 deleted the hand-rolled `loanState`/`liquidityState`/`saleListingState` wrappers and let callers use the auto-getters, tests that asserted `vm.expectRevert` on an unknown ID broke: auto-getters return a zero-valued struct for uninitialized slots rather than reverting. The correct migration is to convert those assertions to zero-value checks (e.g. assert `lender == address(0)`). This is consistent with the existing pattern that view functions resolving by ID *should* revert on unknown IDs only when they are hand-rolled; the auto-getter contract is zeros-for-uninitialized. Pick one contract per getter and make sure the tests match it.

### 10. Sweep dead parameters and ghost fields in a dedicated tidy-up pass

The 11-reviewer pass found a dead ghost field, a dead `GL-68` no-op, a duplicate `GL-39`, the `_freshRate` gas regression above, and a missing fee zero-bps fast path, plus a cosmetic layer of doubled assertions, dead `if (loanId == 0)` guards, a `MockLendingCore.approved` field, `setMarketApproved` no-op calls, parameter shadowing, and a `vm.assume` boundary edge. The dead `factory` parameter in `marketActive`/`requireEligible` is the canonical example: it outlived both the `isMarketApproved` external call and the `CoreNotRegistered` check it was threaded in to support, and survived multiple prior refactors because nothing told anyone it was safe to delete. A dedicated "what is this parameter here for, and is its consumer still alive" pass is the only reliable way to find them.

## Why This Matters

This refactor is the textbook case for why "correct but bloated" is not a stable equilibrium. Vestigial state is not free storage; every field is a field someone has to read, reason about, and not mis-use. The dual loan/loan-pool ID space required every caller to hold both IDs and translate between them, a class of bug (wrong ID passed to the wrong function) that simply cannot exist when there is one ID space. The derived `active` boolean invited the bug where a position is deactivated without zeroing `availableLiquidity` (or vice versa), leaving the two signals disagreeing. The dual market-approval registry invited the bug where `approved` is `true` but `ptToken` is `address(0)`. Deleting the redundancy deletes the bug class.

The gas impact compounds. The measured savings:

- ~67k gas per `createBorrowerLoanPool` (deleted identity maps, counter, struct fields)
- ~5-10k gas per `requireEligible` (8 -> 1 external calls, plus removed `ovrfloInfo` and `isMarketApproved` calls)
- ~2.1k gas per `closeLoan`/`repayLoan` (removed translation SLOADs)
- ~5k gas per liquidity deactivation (removed `active` SSTORE)
- ~2.6k gas per `marketActive` (removed `isMarketApproved` external call)

`createBorrowerLoanPool` and `requireEligible` are the hot paths, the former is every loan origination, the latter is every fill, quote, and eligibility check in the lending market. Cutting ~67k off loan origination and ~5-10k off every eligibility check is a measurable UX improvement at the gas price where retail users actually transact.

The audit-surface argument matters as much as the gas argument. Every line of hand-rolled ceil math is a line a security reviewer has to verify against the rounding semantics; every hand-rolled overflow check is a line a reviewer has to verify against the cast boundary. Replacing them with `Math.mulDiv(Rounding.Up)` and `SafeCast.toUint128` collapses each review to "is the rounding direction right" and "is the target type right", two facts instead of an arithmetic proof. The 11-reviewer pass producing zero P0/P1 findings on the refactored code is the evidence that the simplification worked: less code, fewer places for bugs, easier to verify.

Finally, the empirical-ABI-verification discipline matters beyond Sablier. OVRFLO integrates with Pendle, Sablier, and (via the wrap path) any underlying token. The lesson, `cast call` the deployed contract and decode the return before trusting an interface struct, applies to every one of those integrations. The `isCancelable` field alignment is the sharp example: a struct-shape mistake there would have let a cancelable stream be pledged as collateral, silently breaking the lender's recourse. The fix was not "read the docs more carefully"; it was "ask the chain."

## When to Apply

- When a Solidity protocol has grown organically and you can feel the vestigial state but cannot enumerate it, run a multi-agent review pass to find it; do not rely on a single familiar reviewer.
- When a struct field, mapping, or parameter exists but grep finds no live consumer, delete it, after proving the grep is exhaustive across `src/` and `test/`.
- When a function makes N individual getter calls to an external contract that also exposes a single struct-return call, verify the struct shape empirically against the deployed contract, then collapse to the single call.
- When hand-rolled math (ceil, floor, overflow-checked casts) duplicates an audited OpenZeppelin primitive, replace it and prove equivalence with a differential fuzz test.
- When a mock redeclares an interface struct under a different name, collapse the mock onto the interface; treat mock/interface struct divergence as a bug, not a convenience.
- When a `via_ir = false` project hits `stack too deep`, extract a helper; do not flip `via_ir` on as a local fix.
- When a helper extraction takes a `Struct memory` parameter, check whether a scalar parameter would do, and gas-diff before/after.
- When planning a "behavior-preserving" refactor, enumerate revert-ordering changes explicitly and audit every test that asserts a revert string rather than a revert fact.
- When tests assert `vm.expectRevert` on a view getter for an unknown ID, check whether the getter is now an auto-getter, and convert to a zero-value check if so.

## Examples

**U3 - Duplicate ABI wrapper deletion (`OVRFLOLending.loanState`):**

```solidity
// Before: hand-rolled wrapper duplicating the auto-getter
function loanState(uint256 loanId) external view returns (
    address borrower, address lender, uint256 streamId, ...
) {
    Loan memory loan = _loans[loanId];
    return (loan.borrower, loan.lender, loan.streamId, ...);
}

// After: deleted. Callers use the auto-generated _loans(uint256) getter directly.
// Tests that did vm.expectRevert on unknown IDs now assert borrower == address(0).
```

**U5 - Eight Sablier getters collapsed to one `getStream` call (`requireEligible`):**

```solidity
// Before: 8 external calls to reassemble a stream
uint128 streamed = sablier.streamedAmountOf(streamId);
uint128 withdrawable = sablier.withdrawableAmountOf(streamId);
address recipient = sablier.recipientOf(streamId);
address sender = sablier.senderOf(streamId);
uint40 startTime = sablier.getStartTime(streamId);
uint40 endTime = sablier.getEndTime(streamId);
bool cancelable = sablier.isCancelable(streamId);
bool depleted = sablier.isDepleted(streamId);
// ...assemble Eligibility from the 8 values...

// After: 1 external call returning a struct
ISablierV2LockupLinear.Stream memory stream = sablier.getStream(streamId);
// stream.withdrawnAmount, stream.startTime, stream.endTime, stream.isCancelable, ...
```

The `Stream` and `Amounts` structs were added to `ISablierV2LockupLinear` only after `cast call` against `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` confirmed the 13-word return layout and the `isCancelable` field position was cross-checked against the 7 individual getters on real cancelable streams 50 and 10.

**U7 - Hand-rolled ceil replaced with `Math.mulDiv(Rounding.Up)`:**

```solidity
// Before
uint256 gross = PRBMath.mulDiv(principal, factor, denominator);
if (mulmod(principal, factor, denominator) != 0) gross += 1;

// After
uint256 gross = Math.mulDiv(principal, factor, denominator, Math.Rounding.Up);

// Differential fuzz test added:
// for all (principal, factor, denominator):
//   assert oldCeil(principal, factor, denominator) == Math.mulDiv(..., Rounding.Up)
```

**U7 - Manual overflow check replaced with `SafeCast.toUint128`:**

```solidity
// Before
require(amount <= type(uint128).max, "OVRFLOLending: uint128 overflow");
uint128 casted = uint128(amount);

// After
uint128 casted = SafeCast.toUint128(amount);
// (test updated to expect SafeCast's revert string)
```

**U6 - `_freshRate` helper with the gas regression that almost shipped:**

```solidity
// First cut (net gas regression - copies all 3 SeriesInfo slots)
function _freshRate(SeriesInfo memory info) internal view returns (uint256) {
    _requireOracleFresh(info.twapDurationFixed);
    return _readRate(info);
}

// Shipped (only touches the slot it needs)
function _freshRate(uint32 twapDurationFixed) internal view returns (uint256) {
    _requireOracleFresh(twapDurationFixed);
    return _readRate();
}
```

**U1 - Loan/LoanPool collapsed to a single ID space:**

```solidity
// Before: two ID spaces, three translation maps, two redundant fields
mapping(uint256 => Loan) _loans;               // Loan.lender redundant (== pool lender)
mapping(uint256 => LoanPool) _loanPools;       // LoanPool.totalObligation redundant
uint256 nextLoanPoolId;                        // redundant counter
mapping(uint256 => uint256) loanToLoanPool;    // translation
mapping(uint256 => uint256) loanPoolLoanId;    // translation
// callers carried both IDs and translated; ~249 references across 9 files

// After: one ID space, no translation
mapping(uint256 => Loan) _loans;     // lender recovered from pool, obligation computed
// nextLoanPoolId, loanToLoanPool, loanPoolLoanId, Loan.lender, LoanPool.totalObligation: deleted
// ~67k gas saved per createBorrowerLoanPool; ~2.1k per closeLoan/repayLoan
```

**U2 - Derived boolean dropped in favor of the signal it duplicated:**

```solidity
// Before
require(liquidity.active, "OVRFLOLending: inactive");
// ...and on deactivation: liquidity.active = false; (extra SSTORE, ~5k gas)

// After
require(liquidity.availableLiquidity > 0, "OVRFLOLending: no liquidity");
// deactivation is just: liquidity.availableLiquidity = 0; (one signal, not two)
```

**Dead parameter cleanup (post-review tidy-up):**

```solidity
// Before: factory threaded in to support isMarketApproved + CoreNotRegistered,
// both of which were already deleted in earlier units
function marketActive(address factory, address ptToken) internal view returns (bool) {
    if (ptToken == address(0)) return false;
    // ...isMarketApproved(factory, ptToken) call was here, now gone...
    return true;
}

// After: dead parameter removed
function marketActive(address ptToken) internal view returns (bool) {
    return ptToken != address(0);
}
// ~2.6k gas saved per marketActive call (no external isMarketApproved call to forward to)
```

## Related

- [Solidity hot-path optimization](../best-practices/solidity-hot-path-optimization-patterns.md) — Direct precursor from the prior refactoring pass on `src/*`. Covers the same themes (cache external calls, extract helpers, remove dead struct fields, use OZ `SafeCast` over hand-rolled casts, reorder cheap validation before expensive calls) at a smaller scope. This learning is the larger, multi-commit sequel.
- [Avoid unnecessary uint256 type widening](../best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md) — Direct precursor covering the `_outstanding` cast simplification in `OVRFLOLending`. U7's `SafeCast.toUint128` replacement is the broader application of the same principle.
- [View functions revert on non-existent IDs](./view-functions-revert-on-nonexistent-ids.md) — Documents the hand-rolled-getter contract that view functions resolving by ID must revert on unknown IDs. U3's migration to auto-getters (which return zeros) is the complementary case: when you delete the hand-rolled wrapper, the contract flips and tests must convert `vm.expectRevert` to zero-value checks.
- [OVRFLOBook entry teardown - zero what matters](./ovrflobook-entry-teardown-zero-what-matters.md) — Complementary tension on dead state: runtime slot-zeroing cost vs compile-time dead-state deletion. U2 (drop `active`) is the compile-time side of the same principle the teardown doc states at runtime.
- [OVRFLOBook offer market-active gate](./ovrflobook-offer-market-active-gate.md) — Documents the `_requireMarketActive` wrapper. U8 fixed `gatherLiquidity` to route through this wrapper instead of a raw `StreamPricing.marketActive` call, closing a consistency gap the refactor exposed.
- [Unified offer merge](./unified-offer-merge.md) — Sibling refactor documenting the merge of parallel offer types. Same struct-consolidation methodology applied to a different vestigial-state pattern.
- [Pool-only lending consolidation](./ovrflobook-pool-only-lending-consolidation.md) — Sibling refactor removing the single-party lending path. Same dead-code-removal methodology.
- [Solidity batch function safety patterns](../design-patterns/solidity-batch-function-safety-patterns.md) — Includes the stack-too-deep workarounds (memory arrays, block scoping, helper factoring) that U3's `_loanOutstanding` extraction is an instance of.
- [Record rejected findings with rationale](../best-practices/record-rejected-findings-with-rationale.md) — The 4-agent review and 11-reviewer code review both produced rejected findings; recording rejections is what lets the next review start where this one ended.
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) — Required-reading rule set distilled from these writeups. The dead-parameter and dual-registry deletions here are the negative-space evidence for rules 8 (view functions revert on unknown IDs) and 9 (factory owns every deployed lending).
