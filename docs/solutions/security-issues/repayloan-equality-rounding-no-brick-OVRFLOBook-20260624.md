---
module: OVRFLOBook
date: 2026-06-24
problem_type: security_analysis
component: solidity_contracts
symptoms:
  - "Concern that `bool closes = amount == outstanding;` in `OVRFLOBook.repayLoan` could brick loan closure via an off-by-one from rounding, since strict equality is used to decide whether the loan closes"
root_cause: no_issue_by_design
resolution_type: no_action_needed
severity: informational
tags: [rounding, ceiling, equality, repayLoan, obligation, grossPrice, off-by-one, audit-note, ovrflobook, streamPricing]
---

# Analysis: `repayLoan` close-equality (`amount == outstanding`) cannot brick

## Suspected issue

`OVRFLOBook.repayLoan` decides whether a repayment closes the loan with a
strict equality:

```solidity
uint128 outstanding = _outstanding(loan);
require(outstanding > 0, "OVRFLOBook: nothing outstanding");
require(amount > 0, "OVRFLOBook: repay zero");
require(amount <= outstanding, "OVRFLOBook: repay too much");

loan.repaid += amount;
bool closes = amount == outstanding;
if (closes) {
    loan.closed = true;
}
```

Because `amount` is bounded `<= outstanding` (not `>=`), a leftover 1-wei
residual from rounding would make `amount == outstanding` unreachable and
permanently strand the stream in escrow.

## Conclusion: not an issue

The equality is reachable in every reachable state. There is no rounding path
that produces an unmatchable `outstanding`. Details below.

## 1. Rounding directions in `StreamPricing`

- `grossPrice(remaining, aprBps, ttm) = remaining * WAD / factor` uses
  `PRBMath.mulDiv`, which **truncates** → `grossPrice` **floors**.
- `obligation(borrowAmount, aprBps, ttm)` explicitly adds `+1` when
  `mulmod(borrowAmount, factor, WAD) != 0` → `obligation` **ceils**
  (lender-favorable debt rounding).
- `obligationForFill`:
  - full-borrow path (`borrowAmount == grossPrice`) returns `remaining`
    exactly;
  - partial path (`borrowAmount < grossPrice`) returns the ceiling value.

## 2. `outstanding` is always an exact integer wei

```
_outstanding = obligation - (drawn + repaid)
```

All three terms are integer wei values:
- `obligation` is a `uint128` (the ceiling above).
- `drawn` accumulates exact integer wei from `sablier.withdraw` amounts
  (`claimLoan`/`closeLoan` draw whole-wei amounts).
- `repaid` accumulates exact integer wei from `_pullExact` transfers.

So `outstanding` is always an exact integer `>= 1` at the point the equality
is evaluated (guarded by `require(outstanding > 0)`). There is never a
fractional residual.

## 3. The borrower can always hit `amount == outstanding`

The borrower chooses `amount` and reads `outstanding` from `loanState()`.
`ovrfloToken` is an 18-decimal ERC20, so any 1-wei integer is transferable.
Unlike a brick scenario where `outstanding` would be sub-unit, here it is
always `>= 1` whole wei and the token supports 1-wei transfers. The
`amount <= outstanding` cap plus exact-integer `outstanding` means setting
`amount = outstanding` is always valid and always closes.

## 4. `obligation` can never exceed what the stream can yield

In the partial path `borrowAmount < grossPrice =
floor(remaining * WAD / factor)`, so:

```
obligation = ceil(borrowAmount * factor / WAD) <= remaining
```

Therefore the stream always holds enough (`remaining >= obligation`) for the
lender to recover the remainder via the draw path. The ceiling can make the
lender owed up to 1 extra wei versus the "fair" value, but that 1 wei is an
exact integer the borrower can repay or the stream can cover. It is
intentional lender-favorable debt rounding, not a residual that strands
state.

## 5. Closure is never permanently bricked regardless

Even setting aside the equality being reachable, the loan cannot be stranded:

- `closeLoan` is **permissionless** and closes whenever
  `withdrawable >= outstanding`; it draws the exact integer `outstanding`
  and returns the stream to the borrower.
- Because `obligation - repaid <= remaining` (from §4) and
  `withdrawable` eventually reaches `remaining - drawn`, the inequality
  `withdrawable >= outstanding` is eventually satisfiable, so `closeLoan`
  is always callable in the limit.
- `claimLoan` lets the lender draw `outstanding` down to `0`; once
  `outstanding == 0`, anyone calls `closeLoan` to return the (possibly
  empty) stream.

## 6. Related equality: `borrowAmount == grossPrice_` in `obligationForFill`

The other strict equality in the loan flow,
`if (borrowAmount == grossPrice_) return remaining;`, is safe for the same
reason: `grossPrice` is an exact integer the borrower reads from `quote()`
and passes verbatim, so the full-borrow branch is reliably selected. A
1-off input (`grossPrice - 1`) simply takes the partial path; neither
branch strands state.

## Resolution

No code change. Document the rounding invariants so future edits to
`StreamPricing` (e.g. changing `obligation` to floor, or `grossPrice` to
ceil) are reviewed against this analysis: flipping either direction could
re-introduce a real residual that the equality cannot match.

## Prevention

- Keep `obligation` ceiling and `grossPrice` floor (lender-favorable, and
  keeps `obligation <= remaining`).
- Keep `ovrfloToken` at 18 decimals; do not introduce a coarser-grained
  repayment token without re-checking §3.
- If `repayLoan` ever needs to close on `amount >= outstanding` semantics,
  refund any overpayment rather than reverting, to avoid a new brick from
  the opposite direction.

## Related Issues

- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from writeups.
- `src/OVRFLOBook.sol` — `repayLoan`, `closeLoan`, `claimLoan`,
  `_outstanding`, `_satisfied`.
- `src/StreamPricing.sol` — `grossPrice`, `obligation`,
  `obligationForFill`, `requireEligible`, `marketActive`.

---

## Companion finding: self-matched loans break `repayLoan` (fixed 2026-06-28)

During a full-contract review, a separate edge case in the same loan-servicing
path was identified and fixed.

### The bug

`borrowAgainstOffer` and `lendAgainstListing` did not prevent
`borrower == lender` (self-matching). When a self-matched loan exists,
`repayLoan` calls `_pullExact(ovrfloToken, msg.sender, loan.lender, amount)`
where `from == to`. ERC20 self-transfers leave the balance unchanged, so the
balance-delta check in `_pullExact` (`balanceAfter - balanceBefore == amount`)
sees a zero delta and reverts with `"OVRFLOBook: transfer mismatch"`.

### Impact

Low-medium. Self-matching is economically irrational (the user pays a treasury
fee to themselves), so this is unlikely in practice. The stream is not
permanently stranded — `closeLoan` (permissionless) still works once the stream
accrues, and the borrower can repay from a different address. But the
`repayLoan` path is broken for this state, which is a correctness gap.

### Fix applied

Added `require(msg.sender != offer.lender, "OVRFLOBook: self-match")` in
`borrowAgainstOffer` and `require(msg.sender != listing.borrower,
"OVRFLOBook: self-match")` in `lendAgainstListing`. Prevents the irrational
self-matched loan state at the root cause rather than special-casing the
repayment transfer.

### Files changed

- `src/OVRFLOBook.sol` — `borrowAgainstOffer`, `lendAgainstListing`.

### Test coverage note

The OVRFLOBook non-fork test suite now asserts all-party token balances
(`underlying.balanceOf` and `ovrfloToken.balanceOf` for seller, buyer,
treasury, and the book) after every settlement, per
[best-practices/verify-token-balance-movement-not-just-ownership.md](../best-practices/verify-token-balance-movement-not-just-ownership.md).
Had a self-match test been written at the time, the revert in `_pullExact`
would have been caught at test authoring time rather than during a later
full-contract review.
