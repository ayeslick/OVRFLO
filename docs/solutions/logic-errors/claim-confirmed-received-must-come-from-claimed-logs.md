---
title: Confirmed claim RECEIVED must come from Claimed logs
date: 2026-08-14
category: logic-errors
module: web/lib/claim-receipt.ts, web/components/watch/WatchWrite.tsx
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Confirmed claim receipt showed pre-tx claimable as RECEIVED instead of the on-chain Claimed amount"
  - "UI-REVIEW-CLAIM-CONFIRMED could display invented payout that did not match the lending receipt"
  - "Action receipt RECEIVED line used claimable while the flow was confirmed"
  - "Inventory claim-confirmed scenarios needed receipt logs to assert truthful RECEIVED copy"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [claim, claim-receipt, claimed-log, watch-write, received, checking]
related_components: [web/tests/lib/claim-receipt.test.ts, web/tests/inventory/writes.test.tsx]
---

# Confirmed claim RECEIVED must come from Claimed logs

## Problem

After a claim confirms, the watch write painted RECEIVED from pre-tx
`claimable`. That value is a forecast. The chain pays `Claimed.amount`. Using
the forecast on a confirmed receipt invents money.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- Confirmed ACTION RECEIPT used `claimable` as RECEIVED.
- `UI-REVIEW-CLAIM-CONFIRMED` could disagree with the lending receipt.
- Confirmed RECEIVED had no receipt-log source, so the review forecast
  survived after the write settled.
- Inventory needed a receipt-log fixture before RECEIVED copy could be pinned.

## What Didn't Work

Reusing the review snapshot after confirm. Freeze-what-you-show applies to the
unsigned PAYOUT line. Confirm must recompute from the receipt.

Treating `claimable === 0n` as "no payout". A missing log is not a zero
payout. Zero is a number. Missing evidence is CHECKING….

## Solution

`claimedPayoutFromLogs` parses `Claimed` from the lending receipt, keeps rows
for this `positionId`, and sums `amount`. No match returns `null`
(`web/lib/claim-receipt.ts:5-18`). The lending event is
`Claimed(loanId, positionId, amount, receivedTotal)`
(`src/OVRFLOLending.sol:300`).

`WatchWrite` calls that helper only when `flow.isConfirmed`
(`web/components/watch/WatchWrite.tsx:126-134`). Confirmed copy is either
CHECKING… or the truncated token amount. Pre-confirm still uses `claimable` as
PAYOUT (`web/components/watch/WatchWrite.tsx:487-493`).

`ClaimConfirmedExits` mounts at `UI-REVIEW-CLAIM-CONFIRMED` and prints
RECEIVED from the same payout (`web/components/watch/WatchWrite.tsx:268-276`,
`:339-344`). Unwrap, keep, and CLAIM PT stay as three non-equivalent exits.

Tests: `web/tests/lib/claim-receipt.test.ts` sums two logs and ignores other
positions; null when logs or `positionId` are missing. Inventory 19+G pins
RECEIVED to the receipt fixture, not `claimable`
(`web/tests/inventory/writes.test.tsx:184-208`). Logs are built with
`claimedLog` (`web/tests/lib/claimed-log.ts:6-27`).

## Why This Works

`Claimed.amount` is the wei the market paid this position in that
transaction. `claimable` is a live read from before the click. Those numbers
can differ (pro-rata cap, a later claim on the same loan, a multicall of
several loans).

`null` vs `0n` is the fail-closed split. CHECKING… is not a paid zero
(`web/lib/claim-receipt.ts:9`, `:16-17`; `WatchWrite.tsx:131-133`).

## Prevention

- Never pass pre-tx `claimable` into a confirmed RECEIVED line.
- Keep `claimedPayoutFromLogs` returning `null` when the position is absent
  from the receipt. Do not coerce that to `0n`.
- Inventory 19+G must keep a `Claimed` log fixture whose amount is not the
  same as a dummy `claimable` if the test is to catch a regression.
- A new confirmed write receipt (withdraw, close, repay) must decode the
  matching event. Do not reuse the review snapshot.

## Related Issues

- [Freeze what you show, recompute what you submit](../design-patterns/freeze-what-you-show-recompute-what-you-submit.md)
  — pre-tx `claimable` is the review snapshot; confirmed RECEIVED is receipt
  truth.
- [Adjust-rate multicall shrink race](adjust-rate-multicall-shrink-race.md)
  — same `parseEventLogs` pattern for lending receipt actuals.
- [Borrow presentation must not announce read failures as true zero](../ui-bugs/borrow-presentation-must-not-announce-read-failures-as-true-zero.md)
  — missing evidence is CHECKING…, not zero.
- [Claim-all must never replay confirmed ids](claim-all-must-never-replay-confirmed-ids-and-rereview-changes.md)
  — confirmed work must not reuse stale plan rows.
- [Verify token balance movement, not just ownership](../best-practices/verify-token-balance-movement-not-just-ownership.md)
  — assert money that moved (`Claimed.amount`), not a proxy read.
