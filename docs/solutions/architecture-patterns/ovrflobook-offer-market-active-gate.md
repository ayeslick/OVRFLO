---
title: OVRFLOLENDING liquidity-post market-active gate and shared eligibility dedup
date: 2026-06-24
last_updated: 2026-06-30
category: architecture-patterns
module: OVRFLOLENDING
problem_type: architecture_pattern
component: solidity_contracts
severity: low
applies_when:
  - "Supplying standing liquidity (unified, consumable as sale or loan) in OVRFLOLENDING against a market"
  - "Refactoring shared market/series/maturity eligibility checks across fill and liquidity code paths"
  - "Deciding whether to validate a market at liquidity-supply time versus only at fill time"
tags:
  - ovrflolending
  - liquidity-supply
  - market-validation
  - eligibility
  - dedup
  - single-source-of-truth
  - streampricing
---

# OVRFLOLENDING liquidity-post market-active gate and shared eligibility dedup

## Context

`OVRFLOLENDING` has two order types. One is a **liquidity position** (maker posts
standing liquidity in underlying, no stream bound): `supplyLiquidity` — unified,
consumable as sale or loan. The other is a **sale listing** (maker posts a
specific Sablier stream): `postSaleListing`. All fills and all listings validate
the stream + market via
`StreamPricing.requireEligible` (checks: core registered, market approved,
series approved, not matured, stream sender == core, asset == ovrfloToken,
end time == expiry, no cliff, non-cancelable, remaining > 0).

The liquidity supply function previously validated only the APR and
available liquidity — it accepted ANY `market` argument and pulled funds, deferring all
market/series/maturity checks to fill time (`sellStreamToLiquidity` /
`createBorrowerLoanPool`). So a maker could lock up underlying behind a dead or
unapproved market and only discover the rejection when someone tried to fill it.

## Guidance

Front-load the stream-agnostic subset of `requireEligible` at liquidity-supply time,
and extract that subset into a single shared library function so the same checks
are not duplicated between liquidity-supply and `requireEligible`.

In `src/StreamPricing.sol`, a new library function holds the three checks that do
not need a `streamId`:

```solidity
function marketActive(address factory, address core, address market)
    internal
    view
    returns (uint256 expiryCached, address ovrfloToken)
{
    if (!IOVRFLOFactoryRegistry(factory).isMarketApproved(core, market)) revert MarketNotApproved();
    (bool approved,,, uint256 expiryCached_,, address ovrfloToken_,,) =
        IOVRFLOSeriesRegistry(core).series(market);
    if (!approved) revert SeriesNotApproved();
    if (block.timestamp >= expiryCached_) revert SeriesMatured();
    return (expiryCached_, ovrfloToken_);
}
```

`requireEligible` now delegates to it instead of inlining the same three checks:

```solidity
(address treasury,, address registeredToken) = registry.ovrfloInfo(core);
if (treasury == address(0) || registeredToken == address(0)) revert CoreNotRegistered();
(uint256 expiryCached, address ovrfloToken) = marketActive(factory, core, market);
// ... stream-specific checks follow ...
```

In `src/OVRFLOLENDING.sol`, a thin internal helper and its call site:

```solidity
function _requireMarketActive(address market) internal view {
    StreamPricing.marketActive(address(factory), core, market);
}

function supplyLiquidity(...) external nonReentrant returns (uint256 liquidityId) {
    _validateApr(aprBps);
    _requireMarketActive(market);          // fail fast before pulling funds
    require(availableLiquidity > 0, "OVRFLOLENDING: availableLiquidity zero");
    ...
}
```

The `IOVRFLOSeriesRegistry` import was removed from `OVRFLOLENDING.sol` — the lending market
no longer reads `series()` directly; the pricing library does.

## Why This Matters

- **Maker UX / gas:** funds are no longer pulled for a liquidity position that can never be
  filled (unapproved or already-matured market). Fail-fast at supply.
- **Single source of truth:** the three market/series/maturity checks live in
  exactly one place (`StreamPricing.marketActive`). `requireEligible` calls it;
  `_requireMarketActive` calls it. No duplication.
- **No hot-path gas regression:** `requireEligible` still does exactly one
  `series()` read and one `isMarketApproved` read (it just delegates the
  checks). Liquidity-supply adds the same single read. The alternative of "strip the
  checks from `requireEligible` and call both helpers at fill time" was rejected
  because it would have made every listing/fill do TWO `series()` reads plus two
  `isMarketApproved` calls — a regression on the hot path — just to dedup with
  the rare liquidity-supply path.
- **Reduced import surface:** the lending market no longer imports
  `IOVRFLOSeriesRegistry` directly; series reads are centralized in the pricing
  library.

## When to Apply

- When a maker-side entry point binds a market but not a specific stream/asset,
  and the taker side already validates the full stream — front-load the
  stream-agnostic subset at maker time.
- When the same validation subset appears in two places (a full check and a
  partial pre-check), extract the shared subset into one library/internal
  function and have both delegate to it, rather than duplicating or stripping
  the full check.
- Do NOT front-load stream-specific checks (sender, asset, end time,
  cancelability) at liquidity-supply time — those require a `streamId` the
  liquidity position does not have; keep them in `requireEligible` at fill time.

## Examples

- **Before:** `supplyLiquidity(market = unapprovedMarket, ...)` succeeded and
  pulled 100 underlying; the first `createBorrowerLoanPool` against it reverted with
  `MarketNotApproved`, stranding the lender's capital until `withdrawLiquidity`.
- **After:** `supplyLiquidity(market = unapprovedMarket, ...)` reverts immediately
  with `MarketNotApproved` before any transfer.
- **Test update:** `test_Maturity_NewPositionsBlocked_ExitsLive`
  superseded the old `test_CreateBorrowPool_CancelledOfferReverts`. The old test
  used to unapprove the market BEFORE supplying liquidity (relying on supply not
  checking), then expect `createBorrowerLoanPool` to revert. Now supply rejects
  unapproved markets, so the new test verifies that after maturity, all new
  position creation paths (`supplyLiquidity`, `postSaleListing`,
  `createBorrowerLoanPool`) revert — preserving the fill-time ineligibility intent.

## Related

- `src/OVRFLOLENDING.sol` — `supplyLiquidity`, `withdrawLiquidity`, `_requireMarketActive`.
- `src/StreamPricing.sol` — `marketActive`, `requireEligible`.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md)
  — companion note on `StreamPricing` rounding invariants; its Related section
  lists `marketActive` and `requireEligible`.
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](ovrflobook-entry-teardown-zero-what-matters.md)
  — same module, different concern (entry teardown / storage zeroing).
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups.
