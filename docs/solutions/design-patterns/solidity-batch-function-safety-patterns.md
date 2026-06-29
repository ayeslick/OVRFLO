---
title: "Solidity batch function safety: strictly-increasing IDs, pro-rata claims, and stack-too-deep workarounds"
date: 2026-06-29
last_refreshed: 2026-06-29
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
  - "Computing per-contributor entitlement across multiple loans that share one poolReceived accumulator"
tags:
  - ovrflobook
  - solidity
  - batch-operations
  - duplicate-ids
  - pro-rata
  - claim-pool
  - view-functions
  - stack-too-deep
---

# OVRFLOBook pool batch operations: design patterns and Solidity-specific learnings

## Context

`OVRFLOBook` (a secondary market book for selling or lending against OVRFLO
Sablier streams) gained two atomic batch primitives: `createBorrowPool`
(aggregates multiple lend offers into one borrower loan) and `createLenderPool`
(deploys one lender's capital across multiple borrow listings). Each pool is
followed by two claim channels — `claimPoolShare` (draw from a shared
`poolProceeds` pot) and `poolClaimLoan` (draw directly from a specific loan's
stream) — plus two off-chain `view` "gather" functions that scan the order book
to help callers assemble the ID arrays to pass in.

Implementing these revealed several non-obvious design patterns and security
considerations that are not unique to OVRFLO but apply to any Solidity contract
that accepts ID arrays, shares a claim accumulator across contributors, or scans
large datasets in `view` functions. Four of the five learnings were surfaced
during review and fixed in commits `91df170`, `ca8e248`, `3d03d3e`, and
`dc9f7bc`; the fifth (stack-too-deep) shaped the original function signatures.
This document captures the patterns with the actual code from
`src/OVRFLOBook.sol` so they can be reused and not re-derived.

## Guidance

### 1. Require strictly-increasing IDs in any batch function that takes an ID array

When a function accepts an array of IDs and runs a validation loop followed by a
separate fill loop, always enforce monotonic ordering:

```solidity
function _validateBorrowOffers(uint256[] memory offerIds, address market, uint16 aprBps, address borrower)
    internal
    view
    returns (uint256 totalAvailable)
{
    for (uint256 i = 0; i < offerIds.length; i++) {
        if (i > 0) require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
        LendOffer storage offer = lendOffers[offerIds[i]];
        require(offer.active, "OVRFLOBook: lend offer inactive");
        require(offer.market == market, "OVRFLOBook: market mismatch");
        require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
        require(offer.lender != borrower, "OVRFLOBook: self-match");
        totalAvailable += offer.capacity;
    }
}
```

The same guard appears in `createLenderPool`'s validation loop:

```solidity
for (uint256 i = 0; i < listingIds.length; i++) {
    if (i > 0) require(listingIds[i] > listingIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
    BorrowListing storage listing = borrowListings[listingIds[i]];
    require(listing.active, "OVRFLOBook: borrow listing inactive");
    require(listing.market == market, "OVRFLOBook: market mismatch");
    require(listing.aprBps == aprBps, "OVRFLOBook: apr mismatch");
    require(msg.sender != listing.borrower, "OVRFLOBook: self-match");
    if (uint256(listing.borrowAmount) <= remainingBudget) {
        totalDeployable += listing.borrowAmount;
        remainingBudget -= listing.borrowAmount;
    }
}
```

`require(ids[i] > ids[i-1])` simultaneously rejects duplicates (which would fail
the strict-greater check) and unsorted input. As defense-in-depth, also re-check
the active/liveness flag inside the fill loop even though the validation loop
already verified it — see the `require(listing.active, ...)` re-check in the
`createLenderPool` fill loop below.

### 2. Cap shared-pool claims at the contributor's pro-rata share of the CURRENT pot

When several contributors share a single `poolProceeds` accumulator, a claim
must be bounded by the smaller of (a) the contributor's remaining total
entitlement and (b) their pro-rata slice of the *current* pot balance:

```solidity
function claimPoolShare(uint256 poolId, uint128 amount) external nonReentrant {
    require(poolContributions[poolId][msg.sender] > 0, "OVRFLOBook: not contributor");

    uint256 entitlement = uint256(poolContributions[poolId][msg.sender]) * pools[poolId].totalObligation
        / pools[poolId].totalContributed;
    uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
    require(remaining > 0, "OVRFLOBook: fully claimed");

    // Pro-rata cap: each claim limited to contributor's share of current poolProceeds,
    // preventing one contributor from draining the pot before others can claim.
    uint256 proRataShare =
        uint256(poolProceeds[poolId]) * poolContributions[poolId][msg.sender] / pools[poolId].totalContributed;
    uint256 available = proRataShare;
    if (remaining < available) available = remaining;

    require(amount > 0, "OVRFLOBook: claim zero");
    require(uint256(amount) <= available, "OVRFLOBook: exceeds available");

    poolReceived[poolId][msg.sender] += amount;
    poolProceeds[poolId] -= amount;

    IERC20(ovrfloToken).safeTransfer(msg.sender, amount);

    emit PoolShareClaimed(poolId, msg.sender, amount);
}
```

The formula is `proRataShare = poolProceeds * contribution / totalContributed;
available = min(proRataShare, remaining)`. The `remaining`
(`entitlement - poolReceived`) term still caps the *total* a contributor can
ever pull across both claim channels, so the pro-rata cap only throttles the
*rate* at which the shared pot can be drained — it never lets anyone over-claim
their true share.

### 3. Use the pool's `totalObligation`, not a single loan's `obligation`, for entitlement

A lender pool contains multiple loans, but `poolReceived[poolId][contributor]`
is a *single* accumulator shared across every claim channel. Entitlement must
therefore be computed off the aggregate:

```solidity
uint256 entitlement = uint256(poolContributions[poolId][msg.sender]) * pools[poolId].totalObligation
    / pools[poolId].totalContributed;
uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
```

This identical computation is used in both `poolClaimLoan` (the direct-draw
channel) and `claimPoolShare` (the shared-pot channel). Using an individual
`loan.obligation` instead would break: a contributor who draws from loan A
increments `poolReceived`, which would then incorrectly reduce their remaining
entitlement as if it were scoped to loan B. `totalObligation` (sum of every
loan's obligation in the pool, stored on the `Pool` struct) keeps the two
channels consistent.

### 4. Do not cap `view`-function result sets; let the caller paginate with `startId`

`view` functions are invoked via `eth_call`, which runs off-chain under a very
high gas limit from RPC nodes (typically 1B+), not the ~30M block gas limit that
bounds real transactions. An artificial result cap (the original
`MAX_GATHER_RESULTS = 500`) both fails to bound gas meaningfully and actively
harms callers by hiding available data. The gather functions now size the result
array to the full remaining scan range and let the caller bound scope via
`startId`:

```solidity
function gatherLendCapacities(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)
    external
    view
    returns (uint256[] memory ids, bool sufficient)
{
    StreamPricing.marketActive(address(factory), core, market);
    if (startId >= nextLendOfferId) {
        return (new uint256[](0), false);
    }

    uint256 maxCount = nextLendOfferId - startId;
    ids = new uint256[](maxCount);

    uint256 count;
    uint256 gathered;
    for (uint256 i = startId; i < nextLendOfferId; i++) {
        LendOffer storage offer = lendOffers[i];
        if (offer.active && offer.market == market && offer.aprBps == aprBps && offer.capacity > 0) {
            ids[count++] = i;
            gathered += offer.capacity;
            if (gathered >= targetAmount) break;
        }
    }

    sufficient = gathered >= targetAmount;
    // forge-lint: disable-next-line(unsafe-assembly)
    assembly {
        mstore(ids, count)
    }
}
```

The array is allocated to the worst case (`maxCount = nextLendOfferId - startId`)
and trimmed in place with `mstore(ids, count)`; the `targetAmount` early-exit
and the `startId` offset give the caller all the scope control they need without
a hard count ceiling. `gatherBorrowListings` follows the identical pattern over
`nextBorrowListingId`.

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
        LendOffer storage firstOffer = lendOffers[offerIds[0]];
        require(firstOffer.active, "OVRFLOBook: lend offer inactive");
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

        uint256 totalAvailable = _validateBorrowOffers(offerIds, market, aprBps, msg.sender);
        uint256 actualBorrow = targetBorrow < totalAvailable ? uint256(targetBorrow) : totalAvailable;
        require(actualBorrow >= minAcceptable, "OVRFLOBook: insufficient capacity");
        require(actualBorrow <= grossPrice, "OVRFLOBook: borrow above price");

        obligation = StreamPricing.obligationForFill(
            actualBorrow, grossPrice, eligibility.remaining, aprBps, timeToMaturity
        );
        feeAmount = StreamPricing.fee(actualBorrow, feeBps);
        netToBorrower = actualBorrow - feeAmount;
        actualBorrow128 = _toUint128(actualBorrow);
    }
    // ...
}
```

`memory` for `offerIds`/`listingIds` costs one stack slot (vs two for
`calldata`, which carries both offset and length) and adds only the one-time
copy of the array — negligible relative to the pool's token transfers. The
`{ ... }` blocks drop `firstOffer`, `eligibility`, `timeToMaturity`,
`grossPrice`, `totalAvailable`, and `actualBorrow` from the stack before the
state-mutating section begins. Moving the full validation sweep into
`_validateBorrowOffers` (an `internal` helper) removes its locals from the
caller's frame entirely.

## Why This Matters

These patterns are not stylistic preferences; each prevents a concrete failure
mode in a contract that moves real funds:

- **Duplicate IDs without the strict-increasing guard cause fund theft.** In
  `createBorrowPool`, duplicate offer IDs inflated `totalAvailable` beyond the
  real consumable capacity, so the borrower could receive more underlying than
  was actually drawn from any single offer — stealing from other offers'
  escrowed funds. In `createLenderPool`, duplicate listing IDs created two loans
  against the same escrowed stream and paid the borrower twice. The single
  `require(ids[i] > ids[i-1])` line closes both holes at once.
- **A missing pro-rata cap lets a majority contributor drain the shared pot.**
  Without `available = min(proRataShare, remaining)`, a contributor holding most
  of `totalContributed` can sweep the entire `poolProceeds` balance on their
  first claim, leaving later claimants with nothing in the pot even though their
  `remaining` entitlement is still positive. They are then forced into the more
  expensive `poolClaimLoan` direct-draw path. The pro-rata cap preserves fair,
  rate-limited access to the commons.
- **Per-loan entitlement breaks multi-loan pools.** Because `poolReceived` is a
  single cross-channel accumulator, computing `remaining` from one loan's
  `obligation` makes draws against loan A falsely erode the entitlement
  attributable to loan B. Using `totalObligation` keeps the two claim channels
  reconciled and prevents contributors from being under-paid (or, conversely,
  over-paid if the math is inverted).
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
  consumed twice. Add the `require(ids[i] > ids[i-1])` guard in the first loop,
  and re-assert the liveness/active flag in the second loop as defense-in-depth.
- **Pro-rata claim cap**: any shared accumulator (a pot, a vault balance, a
  streaming queue) from which multiple contributors draw against proportional
  entitlements, where one contributor could otherwise front-run the others'
  claims. Apply when claim order is non-deterministic and a majority holder
  exists.
- **Aggregate-obligation entitlement**: any pool that wraps *multiple* loans (or
  multiple yield sources) behind one per-contributor `received` accumulator.
  Always derive entitlement from the pool-level total, never a single child's
  obligation.
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
    LendOffer storage offer = lendOffers[offerIds[i]];
    require(offer.active, "OVRFLOBook: lend offer inactive");
    require(offer.market == market, "OVRFLOBook: market mismatch");
    require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
    require(offer.lender != borrower, "OVRFLOBook: self-match");
    totalAvailable += offer.capacity;   // duplicate ID => counted twice
}
```

**After (fixed):** strict-increasing guard rejects duplicates and unsorted
input in one check.

```solidity
// FIXED — duplicates/unsorted rejected
for (uint256 i = 0; i < offerIds.length; i++) {
    if (i > 0) require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
    LendOffer storage offer = lendOffers[offerIds[i]];
    require(offer.active, "OVRFLOBook: lend offer inactive");
    require(offer.market == market, "OVRFLOBook: market mismatch");
    require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
    require(offer.lender != borrower, "OVRFLOBook: self-match");
    totalAvailable += offer.capacity;
}
```

**Defense-in-depth in the fill loop:** even though validation already checked
`active`, the fill loop re-asserts it so a future refactor that moves or
drops the validation pass cannot reopen a double-fill:

```solidity
BorrowListing storage listing = borrowListings[listingIds[i]];
if (uint256(listing.borrowAmount) > remainingBudget) continue;
require(listing.active, "OVRFLOBook: borrow listing inactive");
```

### Pro-rata claim cap — before vs. after

**Before (drainable):** the claim was bounded only by `remaining`, so a
majority contributor could take the whole pot.

```solidity
// VULNERABLE — no pro-rata bound on the shared pot
uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
require(uint256(amount) <= remaining, "OVRFLOBook: exceeds available");
poolReceived[poolId][msg.sender] += amount;
poolProceeds[poolId] -= amount;
```

**After (rate-limited):** the claim is the smaller of the pro-rata slice of the
*current* pot and the remaining total entitlement.

```solidity
// FIXED — pro-rata share of current poolProceeds caps each claim
uint256 proRataShare =
    uint256(poolProceeds[poolId]) * poolContributions[poolId][msg.sender] / pools[poolId].totalContributed;
uint256 available = proRataShare;
if (remaining < available) available = remaining;

require(amount > 0, "OVRFLOBook: claim zero");
require(uint256(amount) <= available, "OVRFLOBook: exceeds available");
```

### Aggregate-obligation entitlement — correct usage

Both claim channels share the same entitlement math, keyed on
`pools[poolId].totalObligation`:

```solidity
// poolClaimLoan — direct draw from one loan's stream
uint256 entitlement = uint256(poolContributions[poolId][msg.sender]) * pools[poolId].totalObligation
    / pools[poolId].totalContributed;
uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
```

```solidity
// claimPoolShare — draw from the shared pot (same entitlement)
uint256 entitlement = uint256(poolContributions[poolId][msg.sender]) * pools[poolId].totalObligation
    / pools[poolId].totalContributed;
uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
```

The anti-pattern to avoid is substituting `loans[loanId].obligation` for
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
range and trimmed in place; `startId` and `targetAmount` give the caller
pagination and an early exit.

```solidity
// FIXED — full scan, caller paginates via startId, early-exit via targetAmount
uint256 maxCount = nextLendOfferId - startId;
ids = new uint256[](maxCount);

uint256 count;
uint256 gathered;
for (uint256 i = startId; i < nextLendOfferId; i++) {
    LendOffer storage offer = lendOffers[i];
    if (offer.active && offer.market == market && offer.aprBps == aprBps && offer.capacity > 0) {
        ids[count++] = i;
        gathered += offer.capacity;
        if (gathered >= targetAmount) break;
    }
}
sufficient = gathered >= targetAmount;
assembly { mstore(ids, count) }
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
intermediates, and validation is factored into `_validateBorrowOffers`.

```solidity
// COMPILES — memory array, block-scoped intermediates, factored helper
function createBorrowPool(uint256[] memory offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)
    external nonReentrant returns (uint256 poolId)
{
    address market;
    uint16 aprBps;
    {
        LendOffer storage firstOffer = lendOffers[offerIds[0]];
        require(firstOffer.active, "OVRFLOBook: lend offer inactive");
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
        uint256 totalAvailable = _validateBorrowOffers(offerIds, market, aprBps, msg.sender);
        // ...
    }
}
```

## Related

- `src/OVRFLOBook.sol` — `createBorrowPool`, `createLenderPool`,
  `_validateBorrowOffers`, `_consumeBorrowOffers`, `poolClaimLoan`,
  `claimPoolShare`, `gatherLendCapacities`, `gatherBorrowListings`.
- Fix commits: `91df170` (duplicate IDs + gather allocation + double SSTORE),
  `ca8e248` (pro-rata cap on `claimPoolShare`), `3d03d3e` (bound gather loop to
  `startId + maxCount`), `dc9f7bc` (remove `MAX_GATHER_RESULTS` cap).
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups.
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)
  — companion note on the `active`/`capacity`/`closed` teardown that the
  defense-in-depth `require(listing.active)` re-check relies on.
- [architecture-patterns/view-functions-revert-on-nonexistent-ids.md](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)
  — sibling view-function design rule (pattern #8) that the gather-function
  gas learning extends.
- [best-practices/verify-token-balance-movement-not-just-ownership.md](../best-practices/verify-token-balance-movement-not-just-ownership.md)
  — four-party balance assertion rule (pattern #7) governing pool creation and
  claim tests.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md)
  — loan-closure math that feeds `poolProceeds` via `repayLoan`/`closeLoan`.
