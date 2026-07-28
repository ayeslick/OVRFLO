---
title: "useWriteFlow treated a mined-but-reverted transaction as confirmed across every single-transaction write flow"
date: 2026-07-28
category: logic-errors
module: web/hooks/useWriteFlow
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "ActionModal's shared TxState/ApproveTxState renderer showed a CONFIRMED success state for a transaction that mined but reverted on-chain, across every single-transaction write flow (deposit, borrow, supply, adjust-rate, repay, close)"
  - "useWriteFlow returned isConfirmed: true and error: null for a reverted receipt, because it derived isConfirmed straight from receipt.isSuccess instead of checking receipt.data.status"
  - "The hook's invalidation effect ran its success path (refetching/invalidating on-chain-derived queries) for a transaction that had actually reverted, leaving the UI reflecting a state change that never happened"
  - "BorrowForm and AdjustRateForm's inline StepIndicator error prop stayed false for a mined-but-reverted tx, since it only checked approveTx.error/actionTx.error, which remain null for this failure class"
  - "No error message or recovery affordance was ever shown to the user for a reverted single transaction; the flow looked identical to a genuine success"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags: [usewriteflow, actionmodal, wagmi, viem, transaction-receipt-status, react-hooks, frontend]
related_components: ["web/components/ActionModal.tsx", "web/hooks/useTxQueue", "BorrowForm", "AdjustRateForm", "wagmi useWaitForTransactionReceipt"]
---

# useWriteFlow treated a mined-but-reverted transaction as confirmed across every single-transaction write flow

## Problem

`useWriteFlow.ts` — the hook behind every single-transaction write in the app (deposit, wrap,
unwrap, claim, withdraw, supply, borrow, adjust-rate, repay, close) — derived `isConfirmed:
receipt.isSuccess` verbatim from wagmi's `useWaitForTransactionReceipt`. `isSuccess` only means
the RPC fetch resolved a receipt; it says nothing about the transaction's own on-chain outcome.
A transaction that mines but reverts still resolves `isSuccess: true` with no thrown
`write.error` or `receipt.error`, so every single-tx write flow in the app reported a genuine
on-chain revert to the user as `CONFIRMED`.

This gap was not discovered fresh in this session — it was flagged by name as a known, unfixed
bug in the sibling doc below while that doc's own fix (for `useTxQueue.ts`) was being written,
and spun off as its own follow-up task at that time via the session's task-spawning tool
**(session history)**. This session is that follow-up landing.

## Symptoms

- Any transaction submitted through `useWriteFlow` that passed `eth_estimateGas` (so wagmi's
  `writeContract` broadcast it) but reverted at execution time would resolve with
  `receipt.isSuccess: true` and no `write.error`/`receipt.error` — there was nothing for a user
  or a test to observe as a failure.
- `ActionModal.tsx`'s shared `TxState`/`ApproveTxState` renderers would hit `if (tx.isConfirmed)
  return <div className="label mono status-positive">CONFIRMED</div>` (`web/components/ActionModal.tsx:149`)
  on a reverted tx, and every `StepIndicator` would advance to its final "done" step, since the
  error gate was only `Boolean(approveTx.error ?? actionTx.error)` — a signal that stays `null`
  for this failure class.
- Query invalidation (`invalidateAllOnChainReads`, `scheduleHeldStreamsRetry`) would fire for a
  reverted write, refreshing on-chain reads that hadn't actually changed.
- This was a live, unfixed gap called out by name in the sibling doc's Prevention section
  (`docs/solutions/logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md`) before this
  session started; there was no failing test or bug report driving this fix — it was closed
  proactively from that known gap.

## What Didn't Work

Not a failed fix attempt — the fix went in cleanly on the first pass. What's worth recording
instead is a ruled-out assumption from the investigation: I initially expected the existing
`supply.feature` "transaction reverts" and `repay-close.feature` "repay reverts" e2e scenarios
to already exercise this exact code path, since both are literally named for a transaction
revert. Tracing them showed they don't.

Both scenarios arrange their revert via `drainTokenBalance` (`web/tests/e2e/fixtures/chain.ts:227`),
a helper that drains the relevant token balance through a background wallet *before* the app's
own write is submitted. Because wagmi's `writeContract` runs `eth_estimateGas` before
broadcasting, and the drained balance makes that estimation itself revert, the failure surfaces
as a thrown `write.error` — a pre-flight rejection, not a mined-then-reverted receipt. That path
was never buggy; it's handled correctly by the existing `tx.error` branch in both the old and
new code. Only `claim-all.feature`'s "Error state — a contract revert fails the queue mid-flight"
scenario (`web/tests/e2e/claim-all.feature:20-25`) produces a genuine mined-but-reverted receipt
with no thrown error, because its arrangement (`claimStreamMax`, `web/tests/e2e/fixtures/chain.ts:335`,
calling Sablier's `withdrawMax` directly) races against the queue's own already-computed plan —
the app's write passes gas estimation (state hadn't changed yet when estimated) but reverts at
execution time once the race resolves. That scenario exercises `useTxQueue`, not `useWriteFlow`,
so even it doesn't cover this hook directly.

I deliberately did not add a new e2e scenario reproducing this exact race for a
`useWriteFlow`-based single-tx form (Supply, Borrow, Repay, etc.), for two reasons: constructing
a genuine "estimation succeeds, execution reverts" race for one of this codebase's specific
contract calls needs real experimentation against a live fork, not something derivable from
reading code; and another process was concurrently editing the exact e2e fixture/step files this
would touch (`web/tests/e2e/fixtures/chain.ts`, `web/tests/e2e/steps/*.ts`, several `.feature`
files) during this session, confirmed by a scoped `git stash`/`git stash pop` around only the 3
files this fix touched showing the working tree had picked up unrelated modifications between
the two commands. This is flagged in Prevention as follow-up work, not done here.

## Solution

`web/hooks/useWriteFlow.ts` — read the on-chain outcome from `receipt.data.status` instead of
trusting `receipt.isSuccess` alone, and add a new `isReverted` field for the mined-but-reverted
case:

```ts
// Before
const isConfirmed = receipt.isSuccess;
// (returned to callers as `isConfirmed: receipt.isSuccess`, no isReverted field)

useEffect(() => {
  if (!receipt.isSuccess || !write.data || lastInvalidatedHash.current === write.data) return;
  lastInvalidatedHash.current = write.data;
  invalidateAllOnChainReads(queryClient, user);
  cancelRetry.current?.();
  cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
}, [queryClient, receipt.isSuccess, user, write.data]);
```

```ts
// After (web/hooks/useWriteFlow.ts)
const isConfirmed = receipt.isSuccess && receipt.data?.status === "success";
const isReverted = receipt.isSuccess && receipt.data?.status === "reverted";

useEffect(() => {
  if (!isConfirmed || !write.data || lastInvalidatedHash.current === write.data) return;
  lastInvalidatedHash.current = write.data;
  invalidateAllOnChainReads(queryClient, user);
  cancelRetry.current?.();
  cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
}, [queryClient, isConfirmed, user, write.data]);
```

The hook returns both `isConfirmed` and the new `isReverted`. `error` (`write.error ??
receipt.error`) is unchanged and stays `null` for a mined-but-reverted receipt — nothing throws
for this failure class — which is exactly why a separate `isReverted` flag was needed rather than
folding this into the existing `tx.error` UI branch.

`useApprovalWriteFlows.ts` needed no change: `approveTx`/`actionTx` are raw `useWriteFlow()`
instances, so `.isReverted` passes through to every form that consumes it unchanged.

`web/components/ActionModal.tsx` surfaces the new flag in three places:

- The shared `TxState` and `ApproveTxState` renderers, used by `SupplyForm`, `SimpleActionForm`,
  `ConvertForm`, and `RepayForm`, each gained an `isReverted` branch ahead of the `error` branch:
  `TxState` renders "TRANSACTION REVERTED ON-CHAIN", `ApproveTxState` renders "{label}: REVERTED
  ON-CHAIN".
- `BorrowForm` and `AdjustRateForm` don't use the shared `TxState` renderer for the action
  transaction (they still use `ApproveTxState` for the approval leg) — instead they render
  `isSigning`/`isConfirming`/`isConfirmed`/error state inline, gated by a separate
  `useStaleRecovery` hook keyed on `actionTx.error` for an unrelated liquidity-race "stale"
  classification — so matching inline `isReverted` blocks were added directly in each.
- All six `StepIndicator error={...}` call sites across the file (Supply, SimpleActionForm,
  Convert, Borrow, AdjustRate, Repay) were extended from `Boolean(approveTx.error ??
  actionTx.error)` to also flip to the error visual state on `approveTx.isReverted ||
  actionTx.isReverted` (SimpleActionForm's single-tx variant uses `Boolean(tx.error) ||
  tx.isReverted`).

Test coverage (`web/tests/hooks/useWriteFlow.test.tsx`): widened the `useWaitForTransactionReceipt`
mock's `data` type from an untyped stub to `{ status: "success" | "reverted" } | undefined`. This
forced a fix to two pre-existing tests — "invalidates the two wagmi roots..." and "re-invalidates
the held key on the indexer-lag retry schedule" — that previously set `receiptSuccess = true`
without ever setting `receiptData`. Under the old implementation those tests passed because
`isConfirmed` trusted `isSuccess` alone; under the new implementation they would have silently
stopped detecting confirmation (since `receipt.data?.status` would be `undefined`, never
`"success"`), so both now also set `receiptData: { status: "success" }`. Two new regression tests
were added: "does not invalidate on a mined-but-reverted receipt" and "treats a mined-but-reverted
receipt as isReverted, not isConfirmed", plus a positive-path assertion "surfaces isConfirmed only
once the receipt reports status success".

## Why This Works

Same root insight as the sibling doc: `useWaitForTransactionReceipt` (and viem's
`waitForTransactionReceipt` underneath it) models "did we manage to fetch a receipt for this
hash," not "did the transaction succeed." Once a transaction is mined — success or revert — a
receipt always comes back with no thrown error; the outcome lives only in the receipt's own
`status` field.

What makes this a genuinely separate bug rather than a duplicate of the `useTxQueue.ts` fix is
that `useWriteFlow.ts` and `useTxQueue.ts` share no code — they're two independent hooks that
each independently call `useWaitForTransactionReceipt` and each independently had to get the
status check right. Fixing one did nothing for the other. And the blast radius here is
substantially larger: `useTxQueue.ts` backs only the claim-all queue in `ClaimAllModal.tsx`,
while `useWriteFlow.ts` (via `useApprovalWriteFlows`) backs every single-transaction write form
in `ActionModal.tsx` — deposit, wrap, unwrap, claim, withdraw, supply, borrow, adjust-rate,
repay, and close. Before this fix, any one of those mining-but-reverting was silently reported
to the user as `CONFIRMED`, with the UI advancing to its terminal success step and invalidating
queries as if the write had actually landed.

## Prevention

- Never branch on `useWaitForTransactionReceipt`'s bare `isSuccess`/`isError` to decide whether a
  transaction *succeeded*. Always read `receipt.data?.status === "success"` for the on-chain
  outcome; treat `isSuccess` only as "the receipt is available to inspect," never as "the
  transaction landed." This app has exactly two consumers of the hook (`web/hooks/useWriteFlow.ts`,
  `web/hooks/useTxQueue.ts`) and both now do this correctly — any future third consumer should be
  checked against the same rule at review time.
- When mocking `useWaitForTransactionReceipt` in a hook test in this codebase, the mock's `data`
  field must always be typed to carry `{ status: "success" | "reverted" }`, not just the boolean
  `isSuccess`/`isError`/`isLoading` flags. A mock that only tracks the booleans cannot express the
  "fetch succeeded but the tx reverted" case at all — which is precisely the case most likely to
  be missed in the real implementation, as this bug (and the sibling `useTxQueue.ts` bug before
  it) demonstrates. `web/tests/hooks/useWriteFlow.test.tsx` is the reference shape.
- `useTxQueue.ts` and `useWriteFlow.ts` are sibling hooks that both wrap wagmi's write/receipt
  flow, and this is now the **second** independent instance of a fix or pattern landing in one and
  being missed in the other — the first was a timer-cleanup gap (`useTxQueue.ts` failed to cancel
  a pending retry timer before scheduling a new one, a pattern `useWriteFlow.ts` already had
  correctly; see `docs/solutions/performance-issues/usetxqueue-retry-timer-leak-on-rapid-claims.md`),
  the second is this doc's `isSuccess`/`.status` gap **(session history)**. Neither case was caught
  by code review before an agent noticed the asymmetry directly. Treat any wagmi-receipt-handling
  fix or audit of one hook as reason to check the other by default, and consider whether a
  mechanical check (lint rule or shared helper) could enforce parity between the two rather than
  relying on review to catch drift **(session history)**.
- There is still no e2e scenario that exercises a mined-but-reverted receipt through a
  `useWriteFlow`-based single-tx form (Supply, Borrow, Repay, etc.) the way `claim-all.feature`'s
  "Error state" scenario does for the queue — see What Didn't Work above for why this was
  deliberately deferred. Worth adding once a genuine estimation-succeeds/execution-reverts race is
  found against a real contract call in this codebase; don't assume `supply.feature`'s or
  `repay-close.feature`'s existing "reverts" scenarios cover it, since both currently arrange their
  revert as a pre-flight `eth_estimateGas` failure via `drainTokenBalance`, not a genuine mined
  revert.

## Related Issues

- [useTxQueue treated a mined-but-reverted claim as confirmed, never surfacing the failure caption](usetxqueue-on-chain-revert-treated-as-confirmed.md) —
  the sibling fix for the claim-all queue. That doc's own Prevention section named this exact
  `useWriteFlow.ts` gap as a known, unfixed bug at the time it was written, and — per session
  history — spun it off as this session's follow-up task at that time; this doc closes it.
- [useTxQueue leaked scheduleHeldStreamsRetry timers across rapid claims](../performance-issues/usetxqueue-retry-timer-leak-on-rapid-claims.md) —
  the first independent instance of the same "fix lands in one sibling hook, gets missed in the
  other" drift between `useTxQueue.ts` and `useWriteFlow.ts`; this doc is the second.
- [createBorrowerLoanPool gas-estimation race flakes the repay-close e2e suite](../test-failures/createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md) —
  the same "`waitForTransactionReceipt` doesn't throw on revert" family recurring a third time,
  previously found in the e2e fixture helper `mineAndGetReceipt` rather than application code;
  also the source of the "don't trust a repro against a chain/environment you didn't just start
  yourself" lesson that applied when a stale-snapshot `BlockOutOfRangeError` surfaced while
  investigating this fix (confirmed pre-existing and unrelated to this change via a scoped `git
  stash`).
