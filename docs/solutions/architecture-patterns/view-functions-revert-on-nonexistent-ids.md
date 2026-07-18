---
title: View functions that resolve by ID should revert on non-existent IDs, not return zero defaults
date: 2026-06-27
last_updated: 2026-06-30
last_refreshed: 2026-07-18
category: architecture-patterns
module: OVRFLOLending
problem_type: architecture_pattern
component: solidity_contracts
severity: low
applies_when:
  - "Adding a view function that looks up a struct by ID (offer, listing, loan, or similar)"
  - "Reviewing whether a view function returns garbage for a non-existent or stale ID"
  - "Aligning view function behavior with existing patterns in the same contract"
tags: [view-functions, revert, non-existent-ids, ovrflolending, api-design, zero-address]
---

# View functions that resolve by ID should revert on non-existent IDs, not return zero defaults

## Context

`OVRFLOLending` has three entry types (unified liquidity positions, sale
listings, loans), each stored in a mapping keyed by a monotonically
incrementing ID. At the time this rule was written, hand-rolled view
functions (`offerState`, `saleListingState`, `loanState`) returned the full
struct for a given ID.

`loanState` already reverted for non-existent loan IDs (pre-U3 pattern,
shown for historical reference; `loan.lender` was also removed in U1 since
the lender is always `address(this)`):

```solidity
function loanState(uint256 loanId) external view returns (...) {
    Loan storage loan = loans[loanId];
    require(loan.borrower != address(0), "OVRFLOLending: unknown loan");
    return (loan.borrower, loan.lender, ...);
}
```

But the offer and sale listing view functions silently returned zeroed
defaults for non-existent IDs: `address(0)` for maker/lender, `0` for
capacity, `false` for active. A dashboard or indexer querying a typo'd or
stale ID would get `(address(0), address(0), 0, 0, false)` and could render
it as a legitimate dead entry rather than detecting that the ID never
existed.

## Current state

U3 of the 2026-07 behavior-preserving simplification refactor (see
[behavior-preserving-simplification-refactor.md](./behavior-preserving-simplification-refactor.md),
section #9) deleted all hand-rolled `*State` wrappers (`loanState`,
`liquidityState`, `saleListingState`). `OVRFLOLending` now exposes the
compiler's auto-getters (`liquidityPositions(uint256)`, `saleListings(uint256)`,
`loans(uint256)`, `loanPools(uint256)`) which return a zero-valued struct
for an uninitialized ID rather than reverting. The rule below remains a
valid general principle for hand-rolled view functions, but the
auto-getter contract is zeros-for-uninitialized: tests that previously
asserted `vm.expectRevert` on an unknown ID must convert to zero-value
checks (e.g. `assert(liquidity.lender == address(0))`).

## Rule

**Every hand-rolled view function that resolves a struct by ID must revert
when the ID does not exist.** Use a sentinel field (typically
`lender != address(0)` or `borrower != address(0)`) to detect non-existence,
matching the historical `loanState` pattern.

```solidity
function liquidityState(uint256 liquidityId)
    external
    view
    returns (address lender, address market, uint16 aprBps, uint128 availableLiquidity)
{
    LiquidityPosition storage liquidity = liquidityPositions[liquidityId];
    require(liquidity.lender != address(0), "OVRFLOLending: unknown liquidity");
    return (liquidity.lender, liquidity.market, liquidity.aprBps, liquidity.availableLiquidity);
}
```

The sentinel is the `lender` (or `borrower`) field, which is `address(0)`
in a default-initialized struct and always non-zero for a real entry
because the entry-creation functions require `msg.sender != address(0)`
(guaranteed by EVM rules). Note: the `LiquidityPosition.active` boolean
was removed in U2 of the simplification refactor (the
`availableLiquidity > 0` signal already carries liveness), so a hand-rolled
wrapper must not reach for `active` as the sentinel.

## Why not return zero defaults

Returning zero defaults for a non-existent ID is silent garbage:

- An off-chain indexer sees `(address(0), 0, 0, 0)` and cannot
  distinguish "this liquidity position was depleted" (real entry,
  `availableLiquidity == 0` but `lender` populated) from "this ID was
  never created" (no entry, default struct) unless it re-implements the
  sentinel check the view function should have done.
- A frontend querying by a stale or typo'd ID renders an entry that looks
  real but has no on-chain history, confusing the user.
- A test that queries the wrong ID gets a false positive (the assert passes
  because the zeroed struct matches the expected "dead" state).

Reverting makes the distinction explicit: a non-existent ID is an error, not
a special case of a dead entry.

## Relationship to entry teardown

This rule complements the entry-teardown pattern
([architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)):
teardown zeros `capacity`/`availableLiquidity` (and, pre-U2, `active`) but
leaves `lender`/`borrower` populated. The sentinel check
(`lender != address(0)`) therefore succeeds for torn-down entries (which
are queryable history) and fails only for IDs that were never created. This
is the correct behavior: a depleted liquidity position's state is
queryable, a non-existent ID's state is an error.

## Related

- `src/OVRFLOLending.sol` — the hand-rolled `offerState`, `saleListingState`,
  and `loanState` wrappers documented here were deleted in U3 of the
  simplification refactor; callers now use the auto-getters
  `liquidityPositions`, `saleListings`, `loans`, `loanPools` (which return
  zero-valued structs for uninitialized IDs).
- [architecture-patterns/behavior-preserving-simplification-refactor.md](./behavior-preserving-simplification-refactor.md)
  — section #9 documents the auto-getter zero-return contract that replaced
  the hand-rolled-revert pattern documented here.
- [architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md](../architecture-patterns/ovrflobook-entry-teardown-zero-what-matters.md)
  — companion doc on which struct fields to zero on teardown; the sentinel
  check depends on `lender`/`borrower` surviving teardown.
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — pattern #7 distills this rule as an enforceable check.
- `docs/audit/rejected-findings-record.md` — "Review fixes applied" section
  documents the alignment of the offer and sale listing view functions with
  `loanState`.
