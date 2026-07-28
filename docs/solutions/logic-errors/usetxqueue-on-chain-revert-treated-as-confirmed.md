---
title: "useTxQueue treated a mined-but-reverted claim as confirmed, never surfacing the failure caption"
date: 2026-07-28
category: logic-errors
module: web/hooks/useTxQueue
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "claim-all.feature's \"Error state — a contract revert fails the queue mid-flight\" scenario timed out waiting for the caption \"TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES\" (Error: element(s) not found)"
  - "Claiming a Sablier stream that had already been fully withdrawn elsewhere (withdrawMax -> withdraw(amount=0) -> SablierV2Lockup_WithdrawAmountZero) reverted on-chain, but the claim-all queue advanced past it and showed \"ALL CLAIMS CONFIRMED\" instead of the failure state"
  - "The RESUME button never appeared because useTxQueue's failed flag never flipped to true"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [usetxqueue, claim-all, wagmi, viem, transaction-receipt-status, react-hooks, e2e, sablier]
related_components: ["OVRFLOLending", "Sablier V2", "web/components/ClaimAllModal.tsx"]
last_updated: 2026-07-28
---

# useTxQueue treated a mined-but-reverted claim as confirmed, never surfacing the failure caption

## Problem

`useTxQueue.ts`'s receipt-confirmed effect (`web/hooks/useTxQueue.ts:113-141`) advanced the
claim-all queue and marked a row `"confirmed"` whenever `receipt.isSuccess` was `true`. That
flag reflects only that `useWaitForTransactionReceipt`'s underlying RPC fetch resolved a
receipt — it says nothing about the transaction's own on-chain outcome. `viem`'s
`waitForTransactionReceipt` does not throw for a reverted transaction; it resolves normally
with `receipt.status` set to `"reverted"`. A real on-chain revert (claiming a stream someone
else already fully withdrew) was therefore indistinguishable, from the hook's point of view,
from a genuine success.

## Symptoms

- `claim-all.feature.spec.js -g "contract revert"` failed with `Error: element(s) not found`
  waiting for the caption `TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES`.
- The arrange step `claimStreamMax()` (`web/tests/e2e/fixtures/chain.ts`) calls Sablier's
  `withdrawMax` directly via viem, bypassing the app. By the time the queue's own
  `withdrawMax` call executed, `withdrawableAmountOf` was `0`, so Sablier's `withdraw`
  reverted with `SablierV2Lockup_WithdrawAmountZero` — a genuine on-chain revert, not a
  signature rejection or a JSON-RPC error.
- Because `write.error` and `receipt.error` both stayed `null` (nothing threw), the queue's
  separate failure effect (`web/hooks/useTxQueue.ts:145-152`, keyed on `write.error ?? receipt.error`)
  never fired. The confirmed-effect instead ran its success path, invalidated queries, marked
  the row `"confirmed"`, and — since it was the only queued item — set `done: true`, showing
  `ALL CLAIMS CONFIRMED` for a claim that had actually reverted.

## What Didn't Work

N/A for this session — the bug was found and fixed directly from the e2e failure, with no
earlier fix attempt tried and abandoned here.

(session history) The `claim-all.feature` scenario itself, including its exact revert-arrangement
mechanism (a background client draining the stream via `withdrawMax` before the UI's own queued
claim runs), was authored in an earlier same-day session. That session built the scenario and
asserted the same "TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES" / RESUME-button expectations
this doc's fix now satisfies, but its transcript ends mid-debugging on unrelated environment
issues (wallet-connection crashes in E2E mode, a missing fee approval in the deposit-arrangement
fixture, a matured Pendle market blocking `bootstrap:local`) without ever reaching a green run of
this specific scenario. The receipt-status bug therefore sat latent and unconfirmed from when the
test was written until this session actually ran it end-to-end and found the real failure.

## Solution

Read the on-chain outcome from `receipt.data.status` (`'success' | 'reverted'`,
[viem's `TransactionReceipt`](../../../web/node_modules/viem/_types/types/transaction.d.ts))
instead of trusting `receipt.isSuccess`:

```ts
// web/hooks/useTxQueue.ts — receipt-confirmed effect
useEffect(() => {
  if (!running || !receipt.isSuccess || !write.data || handledHash.current === write.data) return;
  handledHash.current = write.data;
  if (receipt.data?.status !== "success") {
    const failedIndex = index;
    setRows((current) => current.map((row, i) => (i === failedIndex ? { ...row, status: "failed" } : row)));
    setRunning(false);
    return;
  }
  invalidateAllOnChainReads(queryClient, userRef.current);
  // ...unchanged success path (advance index, execute next row)...
}, [execute, index, paused, queryClient, receipt.data, receipt.isSuccess, rows, running, write]);
```

`ClaimAllModal.tsx`'s failure caption was also gated on `queue.error && queue.failed`
(`web/components/ClaimAllModal.tsx:102`). `queue.error` (`write.error ?? receipt.error`) stays
`null` for this class of failure — there is no JS-level error to report, only an on-chain
revert — so the gate was narrowed to `queue.failed` alone, which is exactly the signal the
new status check now sets correctly.

Test coverage: added a `receipt.data.status` field to the `useWaitForTransactionReceipt` mock
in `web/tests/hooks/useTxQueue.test.tsx` (previously the mock had no `data` at all) and a
`revertCurrent` helper plus a dedicated regression test asserting a reverted-but-successfully-fetched
receipt marks the row `"failed"`, stops the queue, and skips invalidation/advance.

## Why This Works

`useWaitForTransactionReceipt` (and the `waitForTransactionReceipt` viem action underneath it)
models "did we manage to fetch a receipt for this hash," not "did the transaction succeed."
Once a transaction is mined, a receipt always comes back — the only way to learn whether it
reverted is the receipt's own `status` field. This is the same class of gap already documented
in [createBorrowerLoanPool gas-estimation race](../test-failures/createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md),
which found and fixed the identical blind spot in the e2e fixtures' `mineAndGetReceipt` helper
(`waitForTransactionReceipt` never itself throwing on a reverted receipt). That fix covered
test-arrangement code; this one covers the same blind spot in application code that runs for
real users — any queued claim, borrow, or repay transaction that reverted on-chain after
mining would previously have been silently accepted as a success by `useTxQueue`.

## Prevention

- Any code that branches on `useWaitForTransactionReceipt`'s `isSuccess`/`isError` to decide
  whether a transaction *succeeded* is checking the wrong signal. Always read
  `receipt.data?.status === "success"` for the on-chain outcome; treat `isSuccess` only as
  "the receipt is available to inspect."
- `useWriteFlow.ts` (`web/hooks/useWriteFlow.ts`) was the other consumer of
  `useWaitForTransactionReceipt` in this codebase, and at the time this doc was originally
  written it had the identical gap: its invalidation effect branched on bare `receipt.isSuccess`
  and it returned `isConfirmed: receipt.isSuccess` verbatim to every caller, with no `.status`
  check anywhere in the hook, so `ActionModal.tsx` rendered a `CONFIRMED` success state straight
  off that flag across every single-transaction form — deposit, borrow, supply, adjust-rate,
  repay, close. That gap has since been fixed in its own follow-up pass — see
  [useWriteFlow treated a mined-but-reverted transaction as confirmed across every single-transaction write flow](usewriteflow-on-chain-revert-treated-as-confirmed.md).
- When mocking `useWaitForTransactionReceipt` in a hook test, always include a `data` field
  alongside `isSuccess`/`isError`/`isLoading` — a mock that only tracks the boolean flags
  cannot express the "fetched fine but the tx reverted" case at all, which is exactly the case
  most likely to be missed in the real implementation.

## Related Issues

- [useWriteFlow treated a mined-but-reverted transaction as confirmed across every single-transaction write flow](usewriteflow-on-chain-revert-treated-as-confirmed.md) —
  the follow-up fix for the identical gap in `useWriteFlow.ts`, flagged as unfixed by this doc's
  Prevention section above and closed in its own pass.
- [createBorrowerLoanPool gas-estimation race flakes the repay-close e2e suite](../test-failures/createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md) —
  the same "`waitForTransactionReceipt` doesn't throw on revert" blind spot, previously found
  and fixed in the e2e fixture helper `mineAndGetReceipt` rather than application code.
- [useTxQueue leaked scheduleHeldStreamsRetry timers across rapid claims](../performance-issues/usetxqueue-retry-timer-leak-on-rapid-claims.md) —
  another `useTxQueue.ts` fix from the same subsystem, unrelated root cause (timer cleanup, not
  receipt-status handling).
- [Web Markets Outcome-First Architecture](../architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md) —
  the architecture writeup for `useTxQueue.ts` and the claim-all queue; worth a short
  cross-reference noting the confirmed-effect's revert-status check.
