---
title: GL-70 stream reuse after loan close breaks drawn-vs-withdrawals property
date: 2026-07-13
category: docs/solutions/logic-errors/
module: Fizz fuzz properties (loan draw accounting)
problem_type: logic_error
component: testing_framework
severity: medium
symptoms:
  - "property_loan_drawn_eq_stream_withdrawals failed on the first loan after closeLoan returned the stream NFT to the borrower"
  - "getWithdrawnAmount is cumulative across ALL uses of a stream, including re-pledges to new loans and external withdrawals"
  - "roundTrip_depositClaim handler's direct sablier.withdraw contaminated the withdrawn total for the original loan"
root_cause: logic_error
resolution_type: test_fix
tags: [fuzz, property-test, stream-reuse, closeloan, getwithdrawnamount, ghost-state, snapshot, gl-70]
---

# GL-70 stream reuse after loan close breaks drawn-vs-withdrawals property

## Problem

The fuzz property `property_loan_drawn_eq_stream_withdrawals` verified that `loan.drawn == getWithdrawnAmount(streamId) - creationSnapshot` for every loan. This check is valid for open loans because the stream is escrowed by the lending contract and no external party can withdraw from it. But after `closeLoan` succeeds, the stream NFT is transferred back to the borrower, who can then re-pledge it to a new loan or withdraw from it directly. `getWithdrawnAmount` is cumulative across all uses of the stream, so it includes withdrawals from subsequent loans and external calls, causing the property to fail on the first (already closed) loan.

## Symptoms

- GL-70 property failure: `loan.drawn != stream withdrawals since creation`
- Failure trace: loan 1 had `drawn=1`, but `getWithdrawnAmount(streamId)` = 17.3e18 (includes withdrawals from loan 2's close + external stream withdrawal)
- The property's skip clause `if (snapshot == 0 && drawn == 0) continue` didn't help because `drawn=1` (loan 1 had a 1-wei draw)

## What Didn't Work

- Initially tried to skip closed loans entirely, but this would miss real bugs where a closed loan's drawn amount doesn't match its stream withdrawals
- Considered tracking which streams had been reused, but this would require complex bookkeeping and wouldn't handle external withdrawals

## Solution

Added a close-time snapshot of the stream's withdrawn amount:

1. Added `mapping(uint256 => uint128) internal ghost_loanStreamWithdrawnAtClose;` to `Base.sol`
2. In `oVRFLOLending_closeLoan` handler: after `lending.closeLoan(loanId)` succeeds, record `ghost_loanStreamWithdrawnAtClose[loanId] = ISablierV2LockupLinear(SABLIER_ADDR).getWithdrawnAmount(streamId)`
3. In `scenario_poolLifecycle`: same snapshot after `closeLoan` succeeds
4. Updated the property:

```solidity
if (closed && closeSnapshot > 0) {
    // Loan closed via closeLoan — stream returned to borrower,
    // may have been reused. Use snapshot at close time.
    eq(uint256(drawn), uint256(closeSnapshot - snapshot), "GL-70: ...");
} else {
    // Open loan, or closed via repayLoan (stream still escrowed).
    // Current getWithdrawnAmount is authoritative.
    // ... original check ...
}
```

## Why This Works

By snapshotting `getWithdrawnAmount` at the moment `closeLoan` succeeds, we capture the exact cumulative withdrawn amount at the end of this loan's lifetime. The delta `closeSnapshot - creationSnapshot` isolates only the withdrawals that occurred during this loan's active period, regardless of what happens to the stream afterward. For loans closed via `repayLoan` (where the stream stays escrowed), `closeSnapshot` is 0 (never set), so the property falls through to the else branch which uses the current withdrawn amount — still valid because no external withdrawals can happen on an escrowed stream.

## Prevention

- When writing fuzz properties that check cumulative external state (like `getWithdrawnAmount`), consider whether that state can change after the subject's lifecycle ends
- For escrowed assets that are returned to the owner, snapshot the external state at return time rather than checking at property evaluation time
- Distinguish between "closed via closeLoan" (asset returned, state may change externally) and "closed via repayLoan" (asset still escrowed, state is authoritative)

## Related Issues

- [Closing stateful fuzz coverage gaps](../best-practices/closing-stateful-fuzz-coverage-gaps.md) - Direct predecessor; GL-70 is the 5th property triage case in the same campaign
- [Pool-only lending consolidation](../architecture-patterns/ovrflobook-pool-only-lending-consolidation.md) - Documents closeLoan returning the stream NFT, which enables the reuse this property must handle
