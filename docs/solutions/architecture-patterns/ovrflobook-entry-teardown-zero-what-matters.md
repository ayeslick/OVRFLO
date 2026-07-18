---
title: OVRFLOLending entry teardown — zero what's critical, keep the rest
date: 2026-06-24
last_updated: 2026-07-18
last_refreshed: 2026-06-24
category: architecture-patterns
module: OVRFLOLending
problem_type: architecture_pattern
component: solidity_contracts
severity: low
applies_when:
  - "Cancelling or filling an OVRFLOLending liquidity position/listing and deciding which struct fields to clear"
  - "Reviewing whether to use `delete` vs partial zeroing on book entries"
  - "Touching loan closure state and wondering whether to erase a closed loan"
tags:
  - ovrflolending
  - storage
  - gas
  - eip-3529
  - delete
  - mapping
  - loan-history
  - state-teardown
---

# OVRFLOLending entry teardown: zero what's critical, keep the rest

## Context

`OVRFLOLending` tears down cancelled/filled entries by setting a few fields to
their defaults rather than `delete`-ing the whole mapping slot. For example:

```solidity
function withdrawLiquidity(uint256 liquidityId) external nonReentrant {
    LiquidityPosition storage liquidity = liquidityPositions[liquidityId];
    require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
    require(liquidity.lender == msg.sender, "OVRFLOLending: not lender");
    uint128 refund = liquidity.availableLiquidity;
    liquidity.availableLiquidity = 0;
    _payUnderlying(msg.sender, refund);
    emit LiquidityWithdrawn(liquidityId, msg.sender, refund);
}
```

`lender`, `market`, and `aprBps` are deliberately left populated. Loans are
never erased at all — only `loan.closed = true`. This is intentional, not
laziness.

## Rule

**Zero only the fields that prevent reuse; leave the rest. Never `delete` a
loan.**

1. Zero the security-critical field that gates double-spend:
   - liquidity positions: `availableLiquidity = 0` (so a second withdraw/sell
     can't re-refund). There is no `active` boolean to flip — U2 removed it
     (see [./behavior-preserving-simplification-refactor.md](./behavior-preserving-simplification-refactor.md));
     `availableLiquidity > 0` is the sole liveness signal.
   - listings: `active = false` (the stream has already been returned/transferred
     out by the cancel/take path).
2. Leave identity/context fields (`lender`, `market`, `aprBps`, `streamId`,
   `feeBps`) populated. They stay queryable via the auto-getters (`loans`,
   `liquidityPositions`, `saleListings`) and cost nothing to retain.
3. For loans, **do not erase**. Set `loan.closed = true` only. The
   `loans(uint256)` auto-getter must keep returning `borrower` / `streamId` /
   `obligation` / `drawn` / `repaid` / `closed` after closure for lenders,
   borrowers, and indexers.

## Why not `delete` the whole entry

**You can't truly delete a mapping entry.** `delete liquidityPositions[liquidityId]`
just writes zeros into the struct's storage slots — same as setting fields to
defaults. The mapping key is permanently occupied regardless; the key itself
cannot be reclaimed. So the only real question is *which slots do I zero?*

**Post-EIP-3529, zeroing extra slots costs net gas, it doesn't save it.**
SSTORE non-zero -> zero costs 5000 gas with only a 4800 gas refund, i.e. ~200
gas net *cost* per extra slot zeroed (pre-London's 15000 refund made zeroing
profitable; that era is over). So a full `delete` charges the canceller more
gas to destroy data that is neither needed nor harmful.

Concretely for `LiquidityPosition` (3 packed slots, 4 fields, no `active`
boolean):
- slot 0: `lender` (20B)
- slot 1: `market` (20B) + `aprBps` (2B)
- slot 2: `availableLiquidity` (16B)

`withdrawLiquidity` must zero slot 2 (`availableLiquidity`) for safety. Slots
0-1 are left alone, saving the ~400 gas of zeroing them.
`delete liquidityPositions[liquidityId]` would also zero slots 0-1 — paying gas
to erase `lender`/`market`/`aprBps` that nobody reads after
`availableLiquidity == 0`. The teardown is now a single
`availableLiquidity = 0` SSTORE within slot 2, not a two-field zero
(`capacity = 0` + `active = false`) as it was pre-U2 — same one slot touched,
one fewer field written.

Listings follow the same logic (only `active` flips; the rest stays). Loans
must not be touched beyond the `closed` flag.

## Why the leftover fields are harmless

A dead entry cannot be reused because every entry point is gated by a value
check, not by zeroing:

- `sellStreamToLiquidity`: `require(liquidity.availableLiquidity > 0)` and
  `require(grossPrice <= liquidity.availableLiquidity)` —
  `availableLiquidity == 0` fails the first check even if the lender field
  were somehow repopulated.
- `withdrawLiquidity`: `require(liquidity.availableLiquidity > 0)` — reverts
  on a second call.
- `buyListing` / `cancelSaleListing`: all `require(listing.active)`.

So leaving `lender` / `market` / `aprBps` populated after
`availableLiquidity = 0` is read-only context (useful for auto-getter queries
and off-chain indexing; events also cover it). There is no path that re-enters
a dead entry.

## Do not `delete` loans — history is a feature

The `loans(uint256)` auto-getter (the public
`mapping(uint256 => Loan) public loans`) is part of the public interface and
is expected to return the full loan record after closure:

```solidity
// loans(loanId) returns the full Loan struct:
(loan.borrower, loan.streamId, loan.obligation,
 loan.drawn, loan.repaid, loan.closed)
```

Erasing a closed loan would:
- break `loans(loanId)` for any historical loan id,
- destroy the audit trail of how the lender was made whole (`drawn` + `repaid`
  vs. `obligation`),
- provide no gas benefit worth that loss (the loan sits idle either way).

The `closed` sentinel is the correct teardown for loans.

## Anti-pattern to avoid

A future "cleanup" pass that replaces the partial zeroing with
`delete liquidityPositions[liquidityId]` (or, worse, `delete loans[loanId]`)
would:

1. cost the caller slightly more gas per cancellation (extra slots zeroed at
   ~200 gas net each), and
2. for loans, permanently destroy queryable loan history — a correctness
   regression for `loans(uint256)` and indexers, not just a style change.

If a reviewer wants to "tidy" the teardown, the answer is: the leftover fields
are harmless and cheaper to leave, and loans must not be erased.

## U2 note: `active` dropped from liquidity positions

The 2026-07 behavior-preserving simplification refactor (U2) removed the
`active` boolean from `LiquidityPosition`, replacing
`require(liquidity.active)` with `require(liquidity.availableLiquidity > 0)`
and dropping the `active = false` write from the teardown. This collapses two
liveness signals into one — the derived `active` boolean was redundant with
`availableLiquidity > 0` and invited the bug where the two disagreed (position
deactivated but capacity left, or vice versa). For liquidity positions,
`availableLiquidity = 0` is now the **sole** teardown signal; the
`active = false` flip no longer exists. Listings still use `active` (their
teardown returns a stream, not a balance). See
[./behavior-preserving-simplification-refactor.md](./behavior-preserving-simplification-refactor.md)
for the full compile-time side of this principle.

## Related

- `src/OVRFLOLending.sol` — `withdrawLiquidity`, `cancelSaleListing`,
  `closeLoan`, `repayLoan`, and the `loans` / `liquidityPositions` /
  `saleListings` auto-getters.
- `test/OVRFLOLending.t.sol` — non-fork tests assert the exact
  `availableLiquidity` / `closed` flips this doc specifies, plus all-party
  token balances per
  [best-practices/verify-token-balance-movement-not-just-ownership.md](../best-practices/verify-token-balance-movement-not-just-ownership.md).
- [./behavior-preserving-simplification-refactor.md](./behavior-preserving-simplification-refactor.md)
  — U2 (drop `active`) is the compile-time side of the same principle this doc
  states at runtime.
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups.
- [architecture-patterns/view-functions-revert-on-nonexistent-ids.md](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)
  — the sentinel check (`lender != address(0)`) depends on teardown leaving
  `lender`/`borrower` populated.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md)
  — companion note on loan closure math.
