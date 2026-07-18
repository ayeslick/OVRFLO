---
title: Unify parallel offer types that differ only in consumption path
date: 2026-06-30
category: docs/solutions/architecture-patterns
module: OVRFLOLending
problem_type: architecture_pattern
component: service_object
severity: low
applies_when:
  - "A contract has two or more maker-side offer/order structs whose fields are identical except for a role-naming field (maker vs lender)"
  - "The offers differ only in which taker-side function consumes them, not in how they are posted, funded, or validated"
  - "Dead functions or struct fields remain from a prior refactor that removed one consumption path"
  - "A pool primitive is restricted to one party (borrower or lender) and the reverse mapping makes an ID parameter redundant"
tags: [unified-offer-type, dead-code-removal, reverse-mapping, solidity-refactor, order-book, attack-surface]
---

# Unify parallel offer types that differ only in consumption path

## Context

`OVRFLOLending` is the secondary market for selling or lending against Sablier
streams produced by the OVRFLO vault. From inception it carried two
maker-side "standing offer" primitives that were structurally near-identical:

- **`SaleOffer`** — liquidity in `underlying` waiting to buy any eligible
  stream from a given Pendle market at a posted APR.
- **`LendOffer`** — liquidity in `underlying` waiting to lend against any
  eligible stream from a given Pendle market at a posted APR.

Both structs held the same five fields in the same order, with one cosmetic
difference: `SaleOffer` named the owner `maker` while `LendOffer` named it
`lender`. Both funded upfront via `_pullExact(underlying, msg.sender, ...)`,
both gated the market with `_requireMarketActive(market)` at post time, both
validated APR bounds via `_validateApr`, both were cancelled by their owner
with a capacity refund, and both exposed a `*OfferState` view with a
sentinel `address(0)` check (pattern #7). The only thing that distinguished
them was **which taker-side function consumed them**: `sellStreamToLiquidity` for
the sale path, `createBorrowerLoanPool` for the loan path.

This artificial distinction produced three kinds of friction:

1. **Code duplication.** `postSaleOffer` / `cancelSaleOffer` /
   `saleOfferState` and `postLendOffer` / `cancelLendOffer` /
   `lendOfferState` were byte-for-byte twins apart from the storage mapping
   and event name. The same was true of `gatherSaleOfferCapacities` and
   `gatherLendOfferCapacities`. Every bug fix, every gas tweak, every
   NatSpec edit had to be applied twice, and reviewers had to verify the two
   copies stayed in sync.

2. **Dead code from a prior refactor.** An earlier change had already
   removed single-party lending (commit `2be9c45`), making pools the only
   lending mechanism. That removal left behind `createLenderPool`,
   `postBorrowListing`, `cancelBorrowListing`, `gatherBorrowListings`, the
   `BorrowListing` struct, and the `Pool.isLend` flag — all unreachable but
   still compiled, audited, and indexed. Dead code is a recurring source of
   review noise and, worse, a trap for future contributors who assume a
   function is live because it exists and is documented.

3. **A redundant parameter on a simplified path.** Once
   `createLenderPool` was gone, every pool had exactly one loan, so
   `poolClaimLoan`'s `loanId` argument was no longer needed to disambiguate
   — it could be derived from the pool itself. Carrying it forward kept a
   caller-supplied ID in scope that could drift from the pool's real loan,
   forcing a defensive `loanPoolId[loanId] == poolId` cross-check that
   served no purpose once the relationship became 1:1. (Note: `poolClaimLoan` was subsequently removed entirely; the sole claim path is now `claimLoanPoolShare(uint256 loanId, uint128 amount)`. U1 of the 2026-07 simplification refactor then collapsed the dual loan/loan-pool ID space so `loanId == loanPoolId`, deleting both the `loanPoolId` forward map and the `poolLoanId` reverse map introduced below — see `./behavior-preserving-simplification-refactor.md`.)

The contract is pre-launch (no deployments), so storage layout changes are
free. This was the moment to collapse the duplication rather than let it
harden into a permanent fork in the type system.

## Guidance

The refactor applies four interlocking practices. They are presented in the
order they were applied, because each one unlocks the next.

### 1. Merge the structs into one type, named for the role-neutral field

Replace the two offer structs with a single `LiquidityPosition` whose owner
field is named `lender`. Keep the field set and order identical to the
originals so the merge is mechanical. The name leans toward the lending
interpretation, but the position is still consumable as either a sale or a
loan — whether the `lender` ends up a buyer or a creditor is determined
later, by the taker. (The original merge used the role-neutral name `maker`;
a later pass standardized on `lender` to match the lending-market vocabulary.)

**Before — two parallel structs:**

```solidity
struct SaleOffer {
    address maker;
    address market;
    uint16 aprBps;
    uint128 capacity;
    bool active;
}

struct LendOffer {
    address lender;   // <-- the only field that differs, and only in name
    address market;
    uint16 aprBps;
    uint128 capacity;
    bool active;
}

mapping(uint256 => SaleOffer) public saleOffers;
mapping(uint256 => LendOffer) public lendOffers;
uint256 public nextSaleOfferId = 1;
uint256 public nextLendOfferId = 1;
```

**After — one unified struct:**

```solidity
struct LiquidityPosition {
    address lender;
    address market;
    uint16 aprBps;
    uint128 availableLiquidity;
    bool active;
}

mapping(uint256 => LiquidityPosition) public liquidityPositions;
uint256 public nextLiquidityId = 1;
```

The NatSpec on the unified struct is the place to record the **intentional
absence** of a sale/loan flag, so a future reader doesn't re-introduce one
thinking it was forgotten:

```solidity
/// @notice Standing liquidity position: underlying waiting to buy or lend against
///         any eligible stream from `market` at `aprBps`. The position is consumable as
///         either a sale (permanent stream transfer via `sellStreamToLiquidity`) or a loan
///         (stream pledged with obligation via `createBorrowerLoanPool`); the lender cannot
///         restrict a position to one path.
struct LiquidityPosition { ... }
```

### 2. Collapse the duplicate functions into one of each kind

With one struct, the posting, cancellation, state, and gather functions
collapse one-to-one. `supplyLiquidity` replaces both `postSaleOffer` and
`postLendOffer`; `withdrawLiquidity` replaces both cancels; the auto-getter
`liquidityPositions` replaces both state views (preserving pattern #7's
`address(0)` sentinel — a non-existent id returns `lender == address(0)`);
a single `gatherLiquidity` replaces the two gather functions.

**Before — two posting functions, byte-identical apart from mapping/event:**

```solidity
function postSaleOffer(address market, uint16 aprBps, uint128 capacity)
    external nonReentrant returns (uint256 offerId)
{
    _validateApr(aprBps);
    _requireMarketActive(market);
    require(capacity > 0, "OVRFLOLending: capacity zero");

    offerId = nextSaleOfferId++;
    saleOffers[offerId] =
        SaleOffer({maker: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

    _pullExact(IERC20(underlying), msg.sender, address(this), capacity);
    emit SaleOfferPosted(offerId, msg.sender, market, aprBps, capacity);
}

function postLendOffer(address market, uint16 aprBps, uint128 capacity)
    external nonReentrant returns (uint256 offerId)
{
    _validateApr(aprBps);
    _requireMarketActive(market);
    require(capacity > 0, "OVRFLOLending: capacity zero");

    offerId = nextLendOfferId++;
    lendOffers[offerId] =
        LendOffer({lender: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

    _pullExact(IERC20(underlying), msg.sender, address(this), capacity);
    emit LendOfferPosted(offerId, msg.sender, market, aprBps, capacity);
}
```

**After — one posting function:**

```solidity
function supplyLiquidity(address market, uint16 aprBps, uint128 availableLiquidity)
    external nonReentrant returns (uint256 liquidityId)
{
    _validateApr(aprBps);
    _requireMarketActive(market);
    require(availableLiquidity > 0, "OVRFLOLending: availableLiquidity zero");

    liquidityId = nextLiquidityId++;
    liquidityPositions[liquidityId] = LiquidityPosition({lender: msg.sender, market: market, aprBps: aprBps, availableLiquidity: availableLiquidity, active: true});

    _pullExact(IERC20(underlying), msg.sender, address(this), availableLiquidity);
    emit LiquiditySupplied(liquidityId, msg.sender, market, aprBps, availableLiquidity);
}
```

The market-active gate (pattern: market-active gate) and the upfront
`_pullExact` funding are preserved exactly — the merge changes **what type
the position is stored as**, never the validation or the money-movement
invariants that the gather/fill paths depend on.

### 3. Remove dead code in a single, named teardown pass

Do not leave unreachable functions in the contract "in case we need them."
Once a consumption path is gone, every function and struct that existed only
to support it is dead weight and a review liability. Remove them in one
commit with a message that enumerates **what** was removed and **why**, so
the deletion is auditable.

In this refactor the teardown pass removed:

- `createLenderPool` (the lender-side pool primitive — unreachable after
  single-party lending was removed).
- `postBorrowListing`, `cancelBorrowListing`, `gatherBorrowListings`, and
  the `BorrowListing` struct (the borrower-side listing primitive, superseded
  by `createBorrowerLoanPool`).
- `Pool.isLend` (a boolean that only distinguished lender pools from
  borrower pools; with one pool kind it is always false).
- The duplicate events `SaleOfferPosted` / `SaleOfferCancelled` /
  `LendOfferPosted` / `LendOfferCancelled`, folded into `LiquiditySupplied` /
  `LiquidityWithdrawn`.

The `StreamSoldToLiquidity` event was **retained**, deliberately. It is a
*consumption* event (a sale into a liquidity position), not a posting event, and the
loan path emits `BorrowerLoanPoolCreated` instead. The two consumption paths have
fundamentally different semantics — a sale permanently transfers the
stream, a loan pledges it with an obligation — so a single unified
consumption event would have to lie about which one happened. Keeping one
event per path is cheaper than a tagged union event and easier to index.

### 4. Derive redundant IDs instead of taking them as arguments

When a relationship collapses from one-to-many to one-to-one, an ID that
was previously needed to select among the many becomes redundant. Derive it
internally and drop the parameter. This removes a caller-supplied value that
could be wrong and the defensive check that guarded against it being wrong.
This refactor did that with a reverse mapping; a later, deeper pass (U1 of
the 2026-07 simplification refactor) went further and collapsed the dual ID
space entirely.

**Before — `poolClaimLoan` took both IDs and cross-checked them:**

```solidity
function poolClaimLoan(uint256 poolId, uint256 loanId, uint128 amount) external nonReentrant {
    require(poolContributions[poolId][msg.sender] > 0, "OVRFLOLending: not contributor");
    require(loanPoolId[loanId] == poolId, "OVRFLOLending: loan not in pool");  // defensive cross-check

    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    ...
}
```

**After (this refactor) — `poolClaimLoan` derives `loanId` from the pool via a reverse mapping:**

```solidity
// storage: mapping(uint256 => uint256) public poolLoanId;  // poolId => loanId

function poolClaimLoan(uint256 poolId, uint128 amount) external nonReentrant {
    require(poolContributions[poolId][msg.sender] > 0, "OVRFLOLending: not contributor");
    uint256 loanId = poolLoanId[poolId];
    require(loanId != 0, "OVRFLOLending: loan not in pool");  // existence, not cross-check

    Loan storage loan = loans[loanId];
    _requireLoanExists(loan);
    ...
}
```

The reverse mapping is written once, in `createBorrowerLoanPool`, alongside the
forward mapping that already existed:

```solidity
uint256 loanId = _storeLoan(msg.sender, address(this), streamId, obligation);
loanPoolId[loanId] = poolId;   // forward:  loanId  -> poolId (existing)
poolLoanId[poolId] = loanId;   // reverse:  poolId  -> loanId (new)
```

The `loanId != 0` check is now an *existence* check (does this pool have a
loan?), not a *consistency* check (does the loan the caller gave me match
the pool the caller gave me?). Existence checks cannot lie; cross-checks
can, when a caller supplies a mismatched pair that happens to satisfy the
guard. The `0` sentinel is safe because loan IDs are monotonic from `1`
(`nextLoanId = 1`), so a real loan is never `0`.

**Postscript — both the function and the maps were later deleted.**
`poolClaimLoan` was removed entirely; the sole claim path is now
`claimLoanPoolShare(uint256 loanId, uint128 amount)`. Then U1 of the
2026-07 simplification refactor collapsed the dual loan/loan-pool ID space
into one — a loan and its pool share a single counter (`nextLoanId`, with
`loanId == loanPoolId`), so the `loanPoolId` forward map and the `poolLoanId`
reverse map added above are both gone. The claim function takes the single
`loanId` (which is also the pool id) directly; no translation maps are
needed because there is nothing to translate between. The deeper lesson:
when a 1:1 relationship is really "two names for the same entity,"
collapsing the ID space beats adding a reverse map — the reverse map was a
correct intermediate, but the single-ID-space design deletes an entire
class of consistency reasoning. See
`./behavior-preserving-simplification-refactor.md` for the U1 teardown.

### 5. Postmortem: the redundant storage field we kept "for forward-compat" was later deleted

One field was *not* removed in this refactor even though it became
derivable: `pools[poolId].totalObligation`. After `createLenderPool` was
removed, every pool had exactly one loan, so `pool.totalObligation ==
loans[poolLoanId[poolId]].obligation` by construction. The original guidance
kept it as a forward-compat hedge: the pro-rata claim math in the pool claim
function (then `claimPoolShare`, via `_claimFair`) read
`pools[poolId].totalObligation` and `pools[poolId].totalContributed` to
compute a contributor's entitlement,

```solidity
uint256 entitlement = uint256(poolContributions[poolId][msg.sender])
    * pools[poolId].totalObligation / pools[poolId].totalContributed;
```

and the argument was that if a future change re-introduced multi-loan pools
(batching several borrower streams under one lender pool), the
`totalObligation` field would already be the correct aggregate. Deleting it
and reading `loan.obligation` instead would bake in the single-loan
assumption at every claim site, so a future multi-loan pool would silently
mis-compute entitlements — a reconciliation bug of exactly the kind pattern
#12 (pro-rata cap) exists to prevent.

**That bet lost.** U1 of the 2026-07 simplification refactor deleted
`Pool.totalObligation` (the struct had been renamed `LoanPool` by then)
because the obligation is recoverable from `loans[id].obligation` in the
single-ID-space design (`loanId == loanPoolId`, so the pool's loan is
`loans[poolId]` directly — no `poolLoanId` lookup needed either). The
forward-compat scenario never materialized: multi-loan pools were never
built, and the redundant `uint128` per pool was just gas cost and cognitive
load the whole time. The claim sites now read `loans[loanId].obligation`
(or the pool's own `totalContributed` for the pro-rata denominator) and
pattern #12 still holds because single-loan-per-pool is now structural, not
guarded by a redundant aggregate.

**Lesson: don't keep redundant fields for hypothetical future needs.** If
the information is recoverable from existing state, delete the redundant
copy and re-add it *if and when* the need actually arises. A redundant field
kept "just in case" is a standing invitation to drift from its source of
truth, and the forward-compat scenario it hedges against usually never
comes — and when it does, you can re-add the field in the same change that
introduces the multiplicity. See
`./behavior-preserving-simplification-refactor.md` for the U1 teardown that
deleted this and the other vestigial fields consolidated here.

## Why This Matters

**Reduced attack surface.** The pre-refactor book had four entry points
that moved `underlying` (`postSaleOffer`, `postLendOffer`, and their two
cancels) doing the same funding/refund dance. A bug in one copy would not
appear in the other, so a diff review could miss it. One `supplyLiquidity`
and one `withdrawLiquidity` means one funding path and one refund path to
audit, fuzz, and write invariant handlers for. The dead-code removal
subtracts a further four unreachable money-moving functions
(`createLenderPool`, `postBorrowListing`, `cancelBorrowListing`,
`gatherBorrowListings`) from the surface a reviewer has to reason about,
even though they were unreachable — a reviewer still has to *confirm* they
are unreachable.

**Simpler mental model.** Before, a new contributor had to learn that
"sale offers are consumed by `sellStreamToLiquidity`, lend offers are
consumed by `createBorrowerLoanPool`, and the two are identical except for
the name of the owner field and the event they emit." After, there is one
liquidity-position type and two consumption functions; the position does
not declare its fate. This is also closer to how the economics actually
work: a liquidity provider posts capital at a rate; whether it becomes a
sale or a loan is the taker's choice, and the lender's terms (market, APR,
availableLiquidity) are identical either way.

**Fewer bugs from duplication.** The twin-function problem is the classic
"fix it in one place, forget the other" trap. With the merge, a change to
the posting path — say, adding a reentrancy guard nuance, or tightening
the availableLiquidity-zero check — happens once. The gather function
collapse has the same benefit: `gatherLiquidity` is the single place where
the market-active gate (pattern: market-active gate) and the
strictly-increasing-ID scan live, so an off-chain integrator has one query
endpoint instead of two to assemble a batch.

**Caller cannot supply a wrong ID.** The `poolClaimLoan` signature change
removed a class of caller error (passing a `loanId` that belongs to a
different pool) that the old cross-check only *detected*, never *prevented*
— it reverted, but only after the caller had already constructed a wrong
call. Deriving the ID internally made the wrong call unconstructable.
(Note: `poolClaimLoan` was later removed entirely; the sole claim path is
now `claimLoanPoolShare(uint256 loanId, uint128 amount)`, and U1 of the
2026-07 simplification refactor collapsed the dual loan/loan-pool ID space
so `loanId == loanPoolId` — the forward and reverse translation maps are
both gone, and the caller's single `loanId` is the pool id. See
`./behavior-preserving-simplification-refactor.md`.)

**Review and test cost drop, and the dropped surface is real.** The diff
deleted 1146 lines and added 369. The test suite (67 unit, 4 invariant at
500 runs / depth 25, 6 attack, 28 fork) still passes, and a six-reviewer
code review found no P0/P1 issues — the three P3 fixes (a dead ghost
variable, NatSpec plurals, a stray TODO comment) were cosmetic. That review
was tractable *because* the surface shrank; reviewing the pre-refactor
twins required confirming parity, which is mechanical but error-prone
work that absorbs reviewer attention from the actual invariants.

## When to Apply

- **Two or more maker-side structs are field-for-field identical apart from
  the name of the owner/role field.** This is the strongest signal. If the
  only thing distinguishing `SaleOffer` from `LendOffer` is `maker` vs
  `lender`, they are the same type wearing different hats.
- **The structs differ only in which taker-side function consumes them, not
  in how they are posted, funded, validated, or cancelled.** If the posting
  mechanics are identical, the distinction is downstream of the post and
  belongs on the consumption side, not the type side.
- **A prior refactor removed one consumption path and left dead functions,
  structs, or flags behind.** Dead code from a teardown that wasn't
  completed is a standing invitation to merge the survivors and delete the
  corpses in the same pass.
- **A pool/batch primitive has been restricted to one creator role
  (borrower-only or lender-only), making a formerly one-to-many
  relationship one-to-one.** When the multiplicity collapses, an ID
  argument that selected among the many becomes derivable via a reverse
  mapping.
- **The contract is pre-launch, or storage layout changes are otherwise
  safe.** Merging structs and renumbering ID counters changes storage
  layout. If there are live deployments, this is a migration, not a
  refactor — apply the practice only when layout is free, or behind a new
  deployed instance.
- **Do NOT apply when the two consumption paths have materially different
  posting mechanics.** If, say, lend offers required a collateral preview
  at post time and sale offers did not, the structs would no longer be
  identical and merging them would force one path to carry the other's
  fields. The unify-when-identical rule cuts the other way: keep them
  separate when they are genuinely different.

## Examples

### Example 1 — Struct merge (the core change)

See the Guidance section's "Before" and "After" blocks under practice 1.
The merge is a one-to-one field correspondence; no field is dropped or
reordered, so any code that read `saleOffers[id].capacity` now reads
`liquidityPositions[id].availableLiquidity` with no semantic change.

### Example 2 — Function merge (supplyLiquidity)

See the Guidance section's practice 2. The single `supplyLiquidity` is the
canonical posting path; the sale/loan fork happens later, at consumption.

### Example 3 — poolClaimLoan simplification

See the Guidance section's practice 4. The 3-arg → 2-arg change is the
cleanest illustration of "derive, don't accept": the caller no longer names
the loan, the pool names its own loan, and the guard becomes an existence
check instead of a cross-check. (Note: `poolClaimLoan` was later removed
entirely; the sole claim path is now `claimLoanPoolShare(uint256 loanId, uint128 amount)`, and U1 of the 2026-07 simplification refactor then collapsed the dual loan/loan-pool ID space so `loanId == loanPoolId` — both translation maps are gone. See `./behavior-preserving-simplification-refactor.md`.)

### Example 4 — Postmortem: the redundant field we kept "on purpose" was later deleted

`Pool.totalObligation` was kept in this refactor despite being equal to
`loans[poolLoanId[poolId]].obligation` for single-loan pools, because the
pro-rata entitlement math in both claim channels read it directly:

```solidity
// poolClaimLoan — direct-draw channel (removed; claimLoanPoolShare is now the sole claim channel)
uint256 entitlement = uint256(poolContributions[poolId][msg.sender])
    * pools[poolId].totalObligation / pools[poolId].totalContributed;

// claimLoanPoolShare — shared-pot channel (pattern #12 pro-rata cap)
uint256 proRataShare = uint256(poolProceeds[poolId])
    * poolContributions[poolId][msg.sender] / pools[poolId].totalContributed;
```

The argument was that if `totalObligation` were deleted and these sites
read `loan.obligation` instead, a future multi-loan pool would compute
entitlement against a single loan's obligation rather than the pool's
aggregate, silently under-paying or over-paying contributors. The redundant
field was the "forward-compatible choice."

**It was not.** U1 of the 2026-07 simplification refactor deleted
`Pool.totalObligation` (the struct had been renamed `LoanPool`) because the
single-ID-space design (`loanId == loanPoolId`) makes the pool's loan
directly addressable as `loans[poolId]`, so the obligation is recoverable
without a redundant aggregate. Multi-loan pools were never built, so the
hedge never paid off and the field was pure gas cost + cognitive load in
the meantime. The claim sites now read `loans[loanId].obligation` and
pattern #12 still holds because single-loan-per-pool is structural. This is
the worked example for the §5 lesson: recoverable information should be
deleted, not hoarded for a hypothetical future that usually never arrives.
See `./behavior-preserving-simplification-refactor.md`.

### Example 5 — The retained event

`StreamSoldToLiquidity` stays; `SaleOfferPosted`/`SaleOfferCancelled`/`LendOfferPosted`/`LendOfferCancelled`
go. The posting events collapse to `LiquiditySupplied`/`LiquidityWithdrawn`
because posting no longer has a sale/loan distinction. The consumption
event does not collapse, because consumption does:

```solidity
// Sale path — permanent stream transfer:
emit StreamSoldToLiquidity(liquidityId, streamId, msg.sender, liquidity.lender, grossPrice, feeAmount, netToSeller);

// Loan path — pledge with obligation, batched across liquidity positions:
emit BorrowerLoanPoolCreated(loanId, msg.sender, market, aprBps, actualBorrow128);
```

A unified `LiquidityConsumed` event would need a `bool isSale` (or an enum)
to say which of two incompatible things happened, plus two different field
sets crammed into one event. Two events with honest semantics are cheaper
to emit and unambiguous to index.

### Example 6 — Invariant handler coverage of the new entry point

The refactor added a `createBorrowerLoanPool` handler to the invariant test
suite (`test/OVRFLOLendingInvariant.t.sol`), so the now-single loan
origination path is exercised by the 500-run / depth-25 invariant run.
This is the testing counterpart to the dead-code removal: the surface that
matters (one pool primitive, one liquidity-position type) gets invariant
coverage, and the surface that was removed no longer needs any coverage at
all.

## Related

- [`docs/solutions/patterns/ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md) — patterns #4 (self-match guard in `createBorrowerLoanPool`), #8 (view functions revert on non-existent IDs, now the `liquidityPositions` auto-getter), #11 (strictly-increasing IDs in batch arrays, now `createBorrowerLoanPool` only), #12 (pro-rata cap on shared-pool claims).
- [`docs/solutions/design-patterns/solidity-batch-function-safety-patterns.md`](../design-patterns/solidity-batch-function-safety-patterns.md) — batch safety patterns that `createBorrowerLoanPool` and `gatherLiquidity` rely on.
- [`docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`](./behavior-preserving-simplification-refactor.md) — sibling refactor; the 2026-07 simplification pass further trimmed the structs consolidated here (deleted `Pool.totalObligation`, the `loanPoolId`/`poolLoanId` translation maps, the `LiquidityPosition.active` derived boolean, and `poolClaimLoan` itself in favor of the single-ID-space `claimLoanPoolShare`).
- Commit `aed261d` — the merge commit (`refactor: merge sale and lend offers into unified offer type`), 369 insertions / 1146 deletions.
- Commit `2be9c45` — the prior refactor that removed single-party lending and made pools the only lending mechanism, leaving the dead code this refactor cleared.
