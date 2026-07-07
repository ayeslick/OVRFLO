---
title: "Solidity batch function safety: strictly-increasing IDs, pool claims, and stack-too-deep workarounds"
date: 2026-06-29
last_refreshed: 2026-07-05
category: design-patterns
module: OVRFLOBook Pool
problem_type: design_pattern
component: solidity_contracts
severity: high
resolution_type: code_fix
applies_when:
  - "Writing a Solidity function that accepts an array of IDs and iterates validation plus fill loops over them"
  - "Designing a shared claim pool where multiple contributors draw from a single accumulator (poolProceeds)"
  - "Implementing view functions that scan large on-chain datasets and deciding whether to cap result counts"
  - "Hitting a stack-too-deep compiler error on a function with many locals plus a calldata array parameter"
  - "Computing per-contributor entitlement against a pool-level totalObligation that backs a shared poolReceived accumulator"
tags:
  - ovrflobook
  - solidity
  - batch-operations
  - duplicate-ids
  - pool-claims
  - claim-pool
  - view-functions
  - stack-too-deep
---

# OVRFLOBook pool batch operations: design patterns and Solidity-specific learnings

## Context

`OVRFLOBook` (a secondary market book for selling or lending against OVRFLO
Sablier streams) exposes one atomic batch primitive: `createBorrowPool`
(aggregates multiple offers into one borrower loan). Lending is pool-only:
the older `createLenderPool` was removed during the single-party-lending
consolidation, and every pool now contains exactly one loan. Offers and sale
listings were unified into a single `offers` mapping (`Offer` struct,
consumable as either a sale via `sellIntoOffer` or a loan via
`createBorrowPool`); the old split `lendOffers`/`borrowListings` mappings and
`LendOffer`/`BorrowListing` structs no longer exist. Each pool is followed by
`claimPoolShare` (draw from a shared `poolProceeds` pot)
plus
one off-chain `view` gather function, `gatherOfferCapacities`, that scans the
order book to help callers assemble the ID array to pass in.

Implementing these revealed several non-obvious design patterns and security
considerations that are not unique to OVRFLO but apply to any Solidity contract
that accepts ID arrays, shares a claim accumulator across contributors, or
scans large datasets in `view` functions. Four of the five learnings were
surfaced during review and fixed in commits `91df170`, `ca8e248`, `3d03d3e`,
and `dc9f7bc`; the fifth (stack-too-deep) shaped the original function
signatures. The pro-rata claim cap introduced by `ca8e248` was later removed
in the M-01 audit fix after it was found to strand minority contributors (see
Section 2). This document captures the patterns with the actual code from
`src/OVRFLOBook.sol` so they can be reused and not re-derived.

## Guidance

### 1. Require strictly-increasing IDs in any batch function that takes an ID array

When a function accepts an array of IDs and runs a validation loop followed by a
separate fill loop, always enforce monotonic ordering:

```solidity
function _validateOffers(uint256[] memory offerIds, address market, uint16 aprBps, address borrower)
    internal
    view
    returns (uint256 totalAvailable)
{
    for (uint256 i = 0; i < offerIds.length; i++) {
        if (i > 0) require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
        Offer storage offer = offers[offerIds[i]];
        require(offer.active, "OVRFLOBook: offer inactive");
        require(offer.market == market, "OVRFLOBook: market mismatch");
        require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
        require(offer.maker != borrower, "OVRFLOBook: self-match");
        totalAvailable += offer.capacity;
    }
}
```

`require(ids[i] > ids[i-1])` simultaneously rejects duplicates (which would
fail the strict-greater check) and unsorted input. The validation pass
(`_validateOffers`) runs first; the fill pass (`_consumeOffers`) then walks the
same IDs and decrements capacity. With the single batch primitive
`createBorrowPool` now in place, both passes operate over the same `offers`
mapping. The strictly-increasing guard in the validation pass is what prevents
a duplicate ID from being consumed twice in the fill pass; the fill pass itself
does not re-assert `offer.active`, so the ordering guard plus the validation
pass are the complete defense — do not drop either when refactoring.

### 2. Cap shared-pool claims at `min(remaining, poolProceeds)` — no pro-rata distribution

When several contributors share a single `poolProceeds` accumulator, a claim
must be bounded by the smaller of (a) the contributor's remaining total
entitlement and (b) what is actually in the pot right now. The current code
does exactly this, with no pro-rata slice:

```solidity
function claimPoolShare(uint256 poolId, uint128 amount) external nonReentrant {
    uint256 remaining = _remainingEntitlement(poolId, msg.sender);

    uint256 available = remaining;
    if (uint256(poolProceeds[poolId]) < available) available = uint256(poolProceeds[poolId]);

    require(amount > 0, "OVRFLOBook: claim zero");
    require(uint256(amount) <= available, "OVRFLOBook: exceeds available");

    poolReceived[poolId][msg.sender] += amount;
    poolProceeds[poolId] -= amount;

    IERC20(ovrfloToken).safeTransfer(msg.sender, amount);

    emit PoolShareClaimed(poolId, msg.sender, amount);
}
```

The formula is `available = min(remaining, poolProceeds)`. The `remaining`
term (`entitlement - poolReceived`, computed by the `_remainingEntitlement`
helper) caps the *total* a contributor can ever pull across both claim
channels, so no one can over-claim their true share. `poolProceeds` caps each
claim at what is actually in the pot. First-come-first-served on proceeds is
acceptable; permanent stranding is not.

**Why the pro-rata cap was removed.** An earlier version (commit `ca8e248`)
capped each claim at `proRataShare = poolProceeds * contribution /
totalContributed`, intending to prevent a majority contributor from draining
the pot before others could claim. It caused the opposite problem: as the pot
shrank, minority contributors' pro-rata share floored to zero, permanently
stranding their proceeds. Concretely, with `totalContributed = 100`, A = 99,
B = 1, and `poolProceeds = 1` after A claims, B's `proRataShare = 1 * 1 / 100
= 0` — B can never draw from the shared pot even though their `remaining`
entitlement is positive. The M-01 audit fix removed the pro-rata cap so that
`available = min(remaining, poolProceeds)` lets any contributor with a
positive remaining entitlement draw whatever is currently in the pot. This is
codified as pattern #12 in
[`ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md):
"Cap shared-pool claims at `min(remaining, poolProceeds)` — no pro-rata
distribution."

### 3. Use the pool's `totalObligation`, not a single loan's `obligation`, for entitlement

A pool contains exactly one loan, but `poolReceived[poolId][contributor]` is a
*single* accumulator shared across every claim channel. Entitlement must
therefore be computed off the pool-level aggregate, which the
`_remainingEntitlement` helper encapsulates:

```solidity
function _remainingEntitlement(uint256 poolId, address account) internal view returns (uint256 remaining) {
    uint128 contribution = poolContributions[poolId][account];
    require(contribution > 0, "OVRFLOBook: not contributor");
    uint256 entitlement = uint256(contribution) * pools[poolId].totalObligation / pools[poolId].totalContributed;
    remaining = entitlement - poolReceived[poolId][account];
    require(remaining > 0, "OVRFLOBook: fully claimed");
}
```

This helper is called by `claimPoolShare` (the sole claim channel), guaranteeing
identical entitlement math. Using an individual `loan.obligation` instead of
`pools[poolId].totalObligation` would break: a contributor who draws from the
direct channel increments `poolReceived`, which would then incorrectly reduce
their remaining entitlement as if the draw were scoped to a different loan.
Although pools now hold a single loan (so `totalObligation` equals that loan's
`obligation`), deriving entitlement from the pool-level total keeps the two
channels consistent and future-proofs the math against any re-introduction of
multi-loan pools. `totalObligation` is stored on the `Pool` struct at creation
time.

### 4. Do not cap `view`-function result sets; let the caller paginate with `startId`

`view` functions are invoked via `eth_call`, which runs off-chain under a very
high gas limit from RPC nodes (typically 1B+), not the ~30M block gas limit that
bounds real transactions. An artificial result cap (the original
`MAX_GATHER_RESULTS = 500`) both fails to bound gas meaningfully and actively
harms callers by hiding available data. The gather function now sizes the
result array to the full remaining scan range and lets the caller bound scope
via `startId`:

```solidity
function gatherOfferCapacities(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)
    external
    view
    returns (uint256[] memory ids, bool sufficient)
{
    StreamPricing.marketActive(address(factory), core, market);
    if (startId >= nextOfferId) {
        return (new uint256[](0), false);
    }

    uint256 maxCount = nextOfferId - startId;
    ids = new uint256[](maxCount);

    uint256 count;
    uint256 gathered;
    for (uint256 i = startId; i < nextOfferId; i++) {
        Offer storage offer = offers[i];
        if (offer.active && offer.market == market && offer.aprBps == aprBps && offer.capacity > 0) {
            ids[count++] = i;
            gathered += offer.capacity;
            if (gathered >= targetAmount) break;
        }
    }

    sufficient = gathered >= targetAmount;

    uint256[] memory result = new uint256[](count);
    for (uint256 i; i < count; i++) {
        result[i] = ids[i];
    }
    ids = result;
}
```

The array is allocated to the worst case (`maxCount = nextOfferId - startId`),
the loop collects matches and early-exits once `targetAmount` is satisfied, and
the result is then copied into a right-sized `result` array via a plain copy
loop (the earlier `assembly { mstore(ids, count) }` in-place trim was removed
in favor of the explicit copy). The `targetAmount` early-exit and the `startId`
offset give the caller all the scope control they need without a hard count
ceiling.

### 5. Defeat stack-too-deep with `memory` array params, block scoping, and helper functions

When a function accumulates many local variables *and* takes an array argument,
the EVM's 16-slot stack limit is easy to exceed. `createBorrowPool` combines all
three workarounds: a `memory` (not `calldata`) array parameter, block scopes
`{ ... }` to retire locals early, and a factored-out validation helper:

```solidity
function createBorrowPool(uint256[] memory offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)
    external
    nonReentrant
    returns (uint256 poolId)
{
    require(targetBorrow > 0, "OVRFLOBook: borrow zero");
    require(offerIds.length > 0, "OVRFLOBook: empty offers");

    address market;
    uint16 aprBps;
    {
        Offer storage firstOffer = offers[offerIds[0]];
        require(firstOffer.active, "OVRFLOBook: offer inactive");
        market = firstOffer.market;
        aprBps = firstOffer.aprBps;
    }

    uint128 obligation;
    uint128 actualBorrow128;
    uint256 netToBorrower;
    uint256 feeAmount;
    {
        StreamPricing.Eligibility memory eligibility = _requireEligible(market, streamId);
        uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
        uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
        require(grossPrice > 0, "OVRFLOBook: price zero");

        uint256 totalAvailable = _validateOffers(offerIds, market, aprBps, msg.sender);
        uint256 actualBorrow = targetBorrow < totalAvailable ? uint256(targetBorrow) : totalAvailable;
        require(actualBorrow <= grossPrice, "OVRFLOBook: borrow above price");

        obligation = StreamPricing.obligationForFill(
            actualBorrow, grossPrice, eligibility.remaining, aprBps, timeToMaturity
        );
        feeAmount = StreamPricing.fee(actualBorrow, feeBps);
        netToBorrower = actualBorrow - feeAmount;
        require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage");
        actualBorrow128 = _toUint128(actualBorrow);
    }

    poolId = nextPoolId++;
    pools[poolId] = Pool({
        creator: msg.sender, aprBps: aprBps, active: true, market: market,
        totalContributed: actualBorrow128, totalObligation: obligation
    });

    _consumeOffers(offerIds, poolId, actualBorrow128);

    uint256 loanId = _storeLoan(msg.sender, address(this), streamId, obligation);
    loanPoolId[loanId] = poolId;
    poolLoanId[poolId] = loanId;

    sablier.transferFrom(msg.sender, address(this), streamId);
    _payUnderlying(msg.sender, netToBorrower);
    _payUnderlying(treasury, feeAmount);

    emit PoolCreated(poolId, msg.sender, market, aprBps, actualBorrow128);
}
```

Note the slippage check: `require(netToBorrower >= minAcceptable, "OVRFLOBook:
slippage")` runs *after* the fee is computed, so `minAcceptable` guards the
net proceeds the borrower actually receives (the M-02 audit fix). An earlier
version checked `require(actualBorrow >= minAcceptable, "OVRFLOBook:
insufficient capacity")` before fees, which could pass even when the fee
eroded the net below what the borrower would accept.

`memory` for `offerIds` costs one stack slot (vs two for `calldata`, which
carries both offset and length) and adds only the one-time copy of the array —
negligible relative to the pool's token transfers. The `{ ... }` blocks drop
`firstOffer`, `eligibility`, `timeToMaturity`, `grossPrice`, `totalAvailable`,
and `actualBorrow` from the stack before the state-mutating section begins.
Moving the full validation sweep into `_validateOffers` (an `internal` helper)
removes its locals from the caller's frame entirely.

## Why This Matters

These patterns are not stylistic preferences; each prevents a concrete failure
mode in a contract that moves real funds:

- **Duplicate IDs without the strict-increasing guard cause fund theft.** In
  `createBorrowPool`, duplicate offer IDs inflated `totalAvailable` beyond the
  real consumable capacity, so the borrower could receive more underlying than
  was actually drawn from any single offer — stealing from other offers'
  escrowed funds. The single `require(ids[i] > ids[i-1])` line in
  `_validateOffers` closes the hole. With `createLenderPool` removed, only one
  batch primitive remains, but the guard is no less critical: the fill pass
  (`_consumeOffers`) does not re-assert `active`, so the ordering check in the
  validation pass is the sole duplicate-prevention mechanism.
- **A pro-rata cap on a shrinking pot strands minority contributors.** The
  pro-rata cap (`poolProceeds * contribution / totalContributed`) was intended
  to prevent a majority contributor from draining `poolProceeds` before others
  could claim. It caused the opposite failure: as the pot shrank, minority
  contributors' pro-rata share floored to zero, permanently stranding their
  proceeds even though their `remaining` entitlement was positive. Removing the
  cap in favor of `available = min(remaining, poolProceeds)` lets any
  contributor with a positive remaining entitlement draw whatever is currently
  in the pot. `poolReceived` still prevents over-claiming; first-come-first-
  served on proceeds is acceptable, permanent stranding is not.
- **Per-loan entitlement breaks cross-channel reconciliation.** Because
  `poolReceived` is a single cross-channel accumulator, computing `remaining`
  from one loan's `obligation` makes draws via the direct channel falsely erode
  the entitlement attributable to the shared-pot channel. Using
  `totalObligation` (encapsulated in `_remainingEntitlement`) keeps the two
  claim channels reconciled and prevents contributors from being under-paid (or,
  conversely, over-paid if the math is inverted).
- **Result caps on `view` functions are unnecessary and harmful.** They do not
  meaningfully bound gas (the `eth_call` limit dwarfs any plausible scan), and
  they silently truncate the data a caller needs to assemble a valid batch.
  Removing the cap and relying on `startId`/`targetAmount` gives callers full
  visibility with built-in scope control.
- **Stack-too-deep is a hard compiler wall, not a warning.** It blocks
  compilation entirely. The `memory`-array + block-scope + helper-function
  toolkit resolves it with minimal gas overhead and no behavioral change, and
  keeps the function readable rather than contorting it to fit 16 slots.

## When to Apply

- **Strictly-increasing IDs**: any function that accepts an array of IDs and
  iterates them more than once (a validation pass plus a fill pass), or any
  batch where the same on-chain resource is referenced by ID and must not be
  consumed twice. Add the `require(ids[i] > ids[i-1])` guard in the first loop.
  If the fill loop does not re-assert the liveness/active flag, the ordering
  guard is the sole duplicate-prevention mechanism — do not drop it.
- **Pool claim cap (`min(remaining, poolProceeds)`)**: any shared accumulator (a
  pot, a vault balance, a streaming queue) from which multiple contributors draw
  against proportional entitlements. Cap each claim by the smaller of the
  contributor's remaining entitlement and the current pot balance. Do *not*
  apply a pro-rata slice of a shrinking pot — it strands minority contributors
  once the pot is partially drained.
- **Aggregate-obligation entitlement**: any pool that wraps one or more loans
  behind a single per-contributor `received` accumulator shared across multiple
  claim channels. Always derive entitlement from the pool-level
  `totalObligation`, never an individual loan's `obligation`, so draws via one
  channel do not falsely erode entitlement attributable to another.
- **No caps on `view` scans**: any read-only function invoked via `eth_call`
  that walks a potentially large mapping range (offers, listings, loans, logs).
  Provide `startId`/offset pagination and an early-exit `target` instead of a
  count ceiling.
- **Stack-too-deep toolkit**: any function that takes an array parameter
  alongside five or more locals (especially nested `memory` structs and
  multiple intermediate uint256s). Reach for `memory` arrays, block scoping,
  and `internal` helpers before any more invasive restructuring.

## Examples

### Duplicate ID prevention — before vs. after

**Before (vulnerable):** the validation loop accepted any IDs and summed
`capacity` per iteration; duplicates were summed twice.

```solidity
// VULNERABLE — no ordering check
for (uint256 i = 0; i < offerIds.length; i++) {
    Offer storage offer = offers[offerIds[i]];
    require(offer.active, "OVRFLOBook: offer inactive");
    require(offer.market == market, "OVRFLOBook: market mismatch");
    require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
    require(offer.maker != borrower, "OVRFLOBook: self-match");
    totalAvailable += offer.capacity;   // duplicate ID => counted twice
}
```

**After (fixed):** strict-increasing guard rejects duplicates and unsorted
input in one check.

```solidity
// FIXED — duplicates/unsorted rejected
for (uint256 i = 0; i < offerIds.length; i++) {
    if (i > 0) require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
    Offer storage offer = offers[offerIds[i]];
    require(offer.active, "OVRFLOBook: offer inactive");
    require(offer.market == market, "OVRFLOBook: market mismatch");
    require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
    require(offer.maker != borrower, "OVRFLOBook: self-match");
    totalAvailable += offer.capacity;
}
```

### Pool claim cap — before vs. after

**Before (strands minorities):** the claim was bounded by a pro-rata slice of
the *current* (shrinking) pot, so a minority contributor's share floored to
zero once the pot was partially drained.

```solidity
// VULNERABLE — pro-rata share of shrinking poolProceeds strands minorities
uint256 proRataShare =
    uint256(poolProceeds[poolId]) * poolContributions[poolId][msg.sender] / pools[poolId].totalContributed;
uint256 available = proRataShare;
if (remaining < available) available = remaining;
// totalContributed=100, A=99, B=1, poolProceeds=1 after A claims:
//   B's proRataShare = 1 * 1 / 100 = 0 → permanently stranded.
require(uint256(amount) <= available, "OVRFLOBook: exceeds available");
```

**After (no stranding):** the claim is the smaller of the remaining total
entitlement and the current pot balance — no pro-rata distribution.

```solidity
// FIXED — min(remaining, poolProceeds); no pro-rata, no stranding
uint256 remaining = _remainingEntitlement(poolId, msg.sender);
uint256 available = remaining;
if (uint256(poolProceeds[poolId]) < available) available = uint256(poolProceeds[poolId]);

require(amount > 0, "OVRFLOBook: claim zero");
require(uint256(amount) <= available, "OVRFLOBook: exceeds available");
```

### Aggregate-obligation entitlement — correct usage

Both claim channels share the same entitlement math via the
`_remainingEntitlement` helper, keyed on `pools[poolId].totalObligation`:

```solidity
// _remainingEntitlement — shared by both claim channels
function _remainingEntitlement(uint256 poolId, address account) internal view returns (uint256 remaining) {
    uint128 contribution = poolContributions[poolId][account];
    require(contribution > 0, "OVRFLOBook: not contributor");
    uint256 entitlement = uint256(contribution) * pools[poolId].totalObligation / pools[poolId].totalContributed;
    remaining = entitlement - poolReceived[poolId][account];
    require(remaining > 0, "OVRFLOBook: fully claimed");
}
```

`claimPoolShare` (draw from the shared pot) calls this helper, so a draw
correctly reduces the remaining entitlement. The anti-pattern to avoid is substituting `loans[loanId].obligation` for
`pools[poolId].totalObligation` in either channel — that breaks the
cross-channel reconciliation because `poolReceived` is incremented by *both*.

### View-function scan — capped vs. uncapped

**Before (harmful cap):** an arbitrary `MAX_GATHER_RESULTS` truncated results
and hid available liquidity from callers.

```solidity
// VULNERABLE/HARMFUL — artificial cap hides data
uint256 constant MAX_GATHER_RESULTS = 500;
// ... loop capped at MAX_GATHER_RESULTS, silently dropping matches beyond it
```

**After (caller-controlled scope):** the array is sized to the full remaining
range, the loop early-exits once `targetAmount` is met, and the result is
copied into a right-sized array; `startId` and `targetAmount` give the caller
pagination and an early exit.

```solidity
// FIXED — full scan, caller paginates via startId, early-exit via targetAmount
uint256 maxCount = nextOfferId - startId;
ids = new uint256[](maxCount);

uint256 count;
uint256 gathered;
for (uint256 i = startId; i < nextOfferId; i++) {
    Offer storage offer = offers[i];
    if (offer.active && offer.market == market && offer.aprBps == aprBps && offer.capacity > 0) {
        ids[count++] = i;
        gathered += offer.capacity;
        if (gathered >= targetAmount) break;
    }
}
sufficient = gathered >= targetAmount;

uint256[] memory result = new uint256[](count);
for (uint256 i; i < count; i++) {
    result[i] = ids[i];
}
ids = result;
```

### Stack-too-deep — `calldata` vs. `memory` plus block scoping

**Before (won't compile):** a `calldata` array plus many locals exceeds 16
stack slots.

```solidity
// FAILS — "stack too deep"
function createBorrowPool(uint256[] calldata offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)
    external nonReentrant returns (uint256 poolId)
{
    // ... eligibility, timeToMaturity, grossPrice, totalAvailable, actualBorrow,
    //     obligation, feeAmount, netToBorrower, market, aprBps all alive at once
}
```

**After (compiles):** `memory` array (1 slot vs 2), block scopes retire
intermediates, and validation is factored into `_validateOffers`. The
slippage check runs on `netToBorrower` (after fees), not `actualBorrow`.

```solidity
// COMPILES — memory array, block-scoped intermediates, factored helper
function createBorrowPool(uint256[] memory offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)
    external nonReentrant returns (uint256 poolId)
{
    address market;
    uint16 aprBps;
    {
        Offer storage firstOffer = offers[offerIds[0]];
        require(firstOffer.active, "OVRFLOBook: offer inactive");
        market = firstOffer.market;
        aprBps = firstOffer.aprBps;
    }
    uint128 obligation;
    uint128 actualBorrow128;
    uint256 netToBorrower;
    uint256 feeAmount;
    {
        // eligibility, timeToMaturity, grossPrice, totalAvailable, actualBorrow
        // all die at the closing brace
        uint256 totalAvailable = _validateOffers(offerIds, market, aprBps, msg.sender);
        // ... fee then slippage: require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage")
    }
}
```

## Related

- `src/OVRFLOBook.sol` — `createBorrowPool`, `_validateOffers`,
  `_consumeOffers`, `claimPoolShare`,
  `gatherOfferCapacities`, `_remainingEntitlement`.
- Fix commits: `91df170` (duplicate IDs + gather allocation + double SSTORE),
  `ca8e248` (pro-rata cap on `claimPoolShare` — later removed by the M-01
  audit fix), `3d03d3e` (bound gather loop to `startId + maxCount`),
  `dc9f7bc` (remove `MAX_GATHER_RESULTS` cap). The M-01 fix removed the
  pro-rata cap in favor of `min(remaining, poolProceeds)`; the M-02 fix moved
  the slippage check to net proceeds (`netToBorrower >= minAcceptable`).
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups. Pattern #11 (strictly-increasing
  IDs) and pattern #12 (cap shared-pool claims at `min(remaining, poolProceeds)`
  — no pro-rata distribution) are the codified forms of Sections 1 and 2.
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)
  — companion note on the `active`/`capacity` teardown that the validation-pass
  `require(offer.active)` check relies on.
- [architecture-patterns/view-functions-revert-on-nonexistent-ids.md](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)
  — sibling view-function design rule (pattern #8) that the gather-function
  gas learning extends.
- [best-practices/verify-token-balance-movement-not-just-ownership.md](../best-practices/verify-token-balance-movement-not-just-ownership.md)
  — four-party balance assertion rule (pattern #7) governing pool creation and
  claim tests.
- [best-practices/triage-fix-and-document-audit-findings.md](../best-practices/triage-fix-and-document-audit-findings.md)
  — the workflow that produced the M-01 (pro-rata cap removal) and M-02 (net
  slippage) fixes referenced in Sections 2 and 5.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md)
  — loan-closure math that feeds `poolProceeds` via `repayLoan`/`closeLoan`.
