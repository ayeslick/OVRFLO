---
title: View functions that resolve by ID should revert on non-existent IDs, not return zero defaults
date: 2026-06-27
last_updated: 2026-06-30
category: architecture-patterns
module: OVRFLOBook
problem_type: architecture_pattern
component: solidity_contracts
severity: low
applies_when:
  - "Adding a view function that looks up a struct by ID (offer, listing, loan, or similar)"
  - "Reviewing whether a view function returns garbage for a non-existent or stale ID"
  - "Aligning view function behavior with existing patterns in the same contract"
tags: [view-functions, revert, non-existent-ids, ovrflobook, api-design, zero-address]
---

# View functions that resolve by ID should revert on non-existent IDs, not return zero defaults

## Context

`OVRFLOBook` has three entry types (unified offers, sale listings, loans),
each stored in a mapping keyed by a monotonically incrementing ID. View
functions (`offerState`, `saleListingState`, `loanState`) return the full
struct for a given ID.

`loanState` already reverted for non-existent loan IDs:

```solidity
function loanState(uint256 loanId) external view returns (...) {
    Loan storage loan = loans[loanId];
    require(loan.borrower != address(0), "OVRFLOBook: unknown loan");
    return (loan.borrower, loan.lender, ...);
}
```

But the offer and sale listing view functions silently returned zeroed
defaults for non-existent IDs: `address(0)` for maker/lender, `0` for
capacity, `false` for active. A dashboard or indexer querying a typo'd or
stale ID would get `(address(0), address(0), 0, 0, false)` and could render
it as a legitimate dead entry rather than detecting that the ID never
existed.

## Rule

**Every view function that resolves a struct by ID must revert when the ID
does not exist.** Use a sentinel field (typically `maker != address(0)` or
`borrower != address(0)`) to detect non-existence, matching the existing
`loanState` pattern.

```solidity
function offerState(uint256 offerId)
    external
    view
    returns (address maker, address market, uint16 aprBps, uint128 capacity, bool active)
{
    Offer storage offer = offers[offerId];
    require(offer.maker != address(0), "OVRFLOBook: unknown offer");
    return (offer.maker, offer.market, offer.aprBps, offer.capacity, offer.active);
}
```

The sentinel is the `maker` (or `lender`, `borrower`) field, which is
`address(0)` in a default-initialized struct and always non-zero for a
real entry because the entry-creation functions require `msg.sender !=
address(0)` (guaranteed by EVM rules).

## Why not return zero defaults

Returning zero defaults for a non-existent ID is silent garbage:

- An off-chain indexer sees `(address(0), 0, 0, false)` and cannot
  distinguish "this offer was cancelled" (real entry, `active == false`)
  from "this offer ID was never created" (no entry, default struct).
- A frontend querying by a stale or typo'd ID renders an entry that looks
  real but has no on-chain history, confusing the user.
- A test that queries the wrong ID gets a false positive (the assert passes
  because the zeroed struct matches the expected "dead" state).

Reverting makes the distinction explicit: a non-existent ID is an error, not
a special case of a dead entry.

## Relationship to entry teardown

This rule complements the entry-teardown pattern
([architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)):
teardown zeros `capacity` and `active` but leaves `maker`/`lender`/`borrower`
populated. The sentinel check (`maker != address(0)`) therefore succeeds for
torn-down entries (which are queryable history) and fails only for IDs that
were never created. This is the correct behavior: a cancelled offer's state
is queryable, a non-existent offer's state is an error.

## Related

- `src/OVRFLOBook.sol` — `offerState`, `saleListingState` (now revert on
  non-existent IDs), `loanState` (pre-existing revert pattern).
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)
  — companion doc on which struct fields to zero on teardown; the sentinel
  check depends on `maker`/`lender`/`borrower` surviving teardown.
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — pattern #8 distills this rule as an enforceable check.
- `docs/audit/rejected-findings-record.md` — "Review fixes applied" section
  documents the alignment of the offer and sale listing view functions with
  `loanState`.
