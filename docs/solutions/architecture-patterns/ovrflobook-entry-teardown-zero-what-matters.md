---
title: OVRFLOBook entry teardown — zero what's critical, keep the rest
date: 2026-06-24
last_refreshed: 2026-06-24
category: architecture-patterns
module: OVRFLOBook
problem_type: architecture_pattern
component: solidity_contracts
severity: low
applies_when:
  - "Cancelling or filling an OVRFLOBook offer/listing and deciding which struct fields to clear"
  - "Reviewing whether to use `delete` vs partial zeroing on book entries"
  - "Touching loan closure state and wondering whether to erase a closed loan"
tags:
  - ovrflobook
  - storage
  - gas
  - eip-3529
  - delete
  - mapping
  - loan-history
  - state-teardown
---

# OVRFLOBook entry teardown: zero what's critical, keep the rest

## Context

`OVRFLOBook` tears down cancelled/filled entries by setting a few fields to
their defaults rather than `delete`-ing the whole mapping slot. For example:

```solidity
function cancelSaleOffer(uint256 offerId) external nonReentrant {
    SaleOffer storage offer = saleOffers[offerId];
    require(offer.active, "OVRFLOBook: offer inactive");
    require(offer.maker == msg.sender, "OVRFLOBook: not offer maker");

    uint128 refund = offer.capacity;
    offer.capacity = 0;
    offer.active = false;

    _payUnderlying(msg.sender, refund);
    emit SaleOfferCancelled(offerId, msg.sender, refund);
}
```

`maker`, `market`, and `aprBps` are deliberately left populated. Loans are
never erased at all — only `loan.closed = true`. This is intentional, not
laziness.

## Rule

**Zero only the fields that prevent reuse; leave the rest. Never `delete` a
loan.**

1. Zero the security-critical field that gates double-spend:
   - offers: `capacity = 0` (so a second cancel/fill can't re-refund) **and**
     `active = false`.
   - listings: `active = false` (the stream has already been returned/transferred
     out by the cancel/take path).
2. Leave identity/context fields (`maker`, `market`, `aprBps`, `streamId`,
   `feeBps`) populated. They stay queryable via the `*State` view functions and
   cost nothing to retain.
3. For loans, **do not erase**. Set `loan.closed = true` only. `loanState` must
   keep returning `obligation` / `drawn` / `repaid` / `closed` after closure for
   lenders, borrowers, and indexers.

## Why not `delete` the whole entry

**You can't truly delete a mapping entry.** `delete saleOffers[offerId]` just
writes zeros into the struct's storage slots — same as setting fields to
defaults. The mapping key is permanently occupied regardless; the key itself
cannot be reclaimed. So the only real question is *which slots do I zero?*

**Post-EIP-3529, zeroing extra slots costs net gas, it doesn't save it.**
SSTORE non-zero -> zero costs 5000 gas with only a 4800 gas refund, i.e. ~200
gas net *cost* per extra slot zeroed (pre-London's 15000 refund made zeroing
profitable; that era is over). So a full `delete` charges the canceller more
gas to destroy data that is neither needed nor harmful.

Concretely for `SaleOffer` (2 packed slots):
- slot 1: `maker` (20B) + `aprBps` (2B)
- slot 2: `capacity` (16B) + `active` (1B)

`cancelSaleOffer` must zero slot 2 (`capacity` + `active`) for safety. Slot 1 is
left alone, saving the ~200 gas of zeroing it. `delete saleOffers[offerId]`
would also zero slot 1 — paying gas to erase `maker`/`aprBps` that nobody reads
after `active == false`.

Listings follow the same logic (only `active` flips; the rest stays). Loans
must not be touched beyond the `closed` flag.

## Why the leftover fields are harmless

A dead entry cannot be reused because every entry point is gated by `active`
plus a value check, not by zeroing:

- `sellIntoOffer`: `require(offer.active)` and `require(grossPrice <= offer.capacity)`
  — `capacity == 0` fails the second check even if `active` were somehow true.
- `cancelSaleOffer` / `cancelLendOffer`: `require(offer.active)` — reverts on a
  second call.
- `buyListing` / `createLenderPool` / `cancelSaleListing` / `cancelBorrowListing`:
  all `require(*.active)`.

So leaving `maker` / `market` / `aprBps` populated after `active = false` is
read-only context (useful for `*State` queries and off-chain indexing; events
also cover it). There is no path that re-enters a dead entry.

## Do not `delete` loans — history is a feature

`loanState(loanId)` is part of the public interface and is expected to return
the full loan record after closure:

```solidity
return (loan.borrower, loan.lender, loan.streamId, loan.obligation,
        loan.drawn, loan.repaid, _outstanding(loan), loan.closed);
```

Erasing a closed loan would:
- break `loanState` for any historical loan id,
- destroy the audit trail of how the lender was made whole (`drawn` + `repaid`
  vs. `obligation`),
- provide no gas benefit worth that loss (the loan sits idle either way).

The `closed` sentinel is the correct teardown for loans.

## Anti-pattern to avoid

A future "cleanup" pass that replaces the partial zeroing with
`delete saleOffers[offerId]` (or, worse, `delete loans[loanId]`) would:

1. cost the caller slightly more gas per cancellation (extra slots zeroed at
   ~200 gas net each), and
2. for loans, permanently destroy queryable loan history — a correctness
   regression for `loanState` and indexers, not just a style change.

If a reviewer wants to "tidy" the teardown, the answer is: the leftover fields
are harmless and cheaper to leave, and loans must not be erased.

## Related

- `src/OVRFLOBook.sol` — `cancelSaleOffer`, `cancelLendOffer`, `cancelSaleListing`,
  `cancelBorrowListing`, `closeLoan`, `repayLoan`, and the `*State` views.
- `test/OVRFLOBook.t.sol` — non-fork tests assert the exact `active`/`capacity`/
  `closed` flips this doc specifies, plus all-party token balances per
  [best-practices/verify-token-balance-movement-not-just-ownership.md](../best-practices/verify-token-balance-movement-not-just-ownership.md).
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups.
- [architecture-patterns/view-functions-revert-on-nonexistent-ids.md](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)
  — the sentinel check (`maker != address(0)`) depends on teardown leaving
  `maker`/`lender`/`borrower` populated.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md)
  — companion note on loan closure math.
