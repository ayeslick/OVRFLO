---
title: "RepayForm's loan and balance reads never noticed a loan closing or a balance draining from outside the modal"
date: 2026-07-28
category: ui-bugs
module: web/components/ActionModal
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "repay-close.feature's \"Error state — the loan disappears while the modal is open\" scenario timed out waiting for the caption \"LOAN NOT FOUND\" (Error: element(s) not found) after another channel fully repaid the loan while the REPAY LOAN modal stayed open with no further click"
  - "The modal kept showing the stale pre-repayment state (\"OUTSTANDING 1.95 ovrfloWSTETH\") indefinitely instead of ever recognizing the loan had closed"
  - "In a related scenario, the modal's own \"INSUFFICIENT BALANCE\" validation intermittently failed to appear after an out-of-band balance drain, because the balance read had already resolved (with the old, sufficient balance) microseconds before the drain transaction landed on-chain, and nothing ever refetched it afterward"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [repay-close, usebbserverloans, wagmi, react-query, refetch-interval, e2e, stale-read, loan-closed]
related_components: ["web/hooks/useBorrowerLoans.ts", "web/components/ActionModal.tsx", "OVRFLOLending"]
---

# RepayForm's loan and balance reads never noticed a loan closing or a balance draining from outside the modal

## Problem

`RepayForm` (`web/components/ActionModal.tsx:1400`) reads two pieces of on-chain state that can
change from outside the modal's own write flow — the loan itself (via `useBorrowerLoans`,
`web/hooks/useBorrowerLoans.ts:12`) and the connected wallet's ovrfloToken balance (`balanceRead`,
`web/components/ActionModal.tsx:1448`). Both reads were plain `useReadContract(s)` calls with no
`refetchInterval`, invalidated only by `invalidateAllOnChainReads` — which only fires when *this
client's own* wagmi write confirms (`web/hooks/useWriteFlow.ts`). Neither the loan closing nor the
balance draining necessarily has any such write: a loan can be repaid or closed by a completely
different transaction (anyone can call `closeLoan` permissionlessly; the borrower can repay from a
different session), and a balance can be drained by a transfer that has nothing to do with this
modal. With no invalidation trigger and no polling, both reads were stuck showing whatever they
fetched on mount, forever.

## Symptoms

- `repay-close.feature.spec.js -g "loan disappears"` failed with `Error: element(s) not found`
  waiting for the caption `LOAN NOT FOUND`, after the arrange step `repayLoanFully()`
  (`web/tests/e2e/fixtures/chain.ts`) repaid the loan directly via viem — bypassing the app
  entirely, with no click in the scenario after the repay.
- Separately, `useBorrowerLoans`'s read (`web/hooks/useBorrowerLoans.ts:16-24`) never filtered out
  a closed loan even once it *did* refetch: the contract never zeroes a closed loan's `borrower`
  in the `loans` mapping, it just flips `closed: true` in place
  (`src/OVRFLOLending.sol:467`, `:501`). So even after fixing the missing refetch, `RepayForm`'s
  original `if (!loan) return <LOAN NOT FOUND>` (`web/components/ActionModal.tsx:1479`, pre-fix)
  never fired for an externally-closed loan — `loan` was still found, just `closed`.
- A second, related gap: `balanceRead` (`web/components/ActionModal.tsx:1448`) is used to compute
  `validationError` (`INSUFFICIENT BALANCE`, `:1468`). Debug instrumentation (a temporary
  `console.log` of `balanceRead.status`/`dataUpdatedAt` plus a `page.on("console", ...)` forwarder)
  showed the read resolving with the pre-drain, sufficient balance ~6ms before a fixture-direct
  drain's transaction actually landed on-chain — a race the read had no way to recover from
  afterward, since nothing else ever refetches it.

## What Didn't Work

The loan-closed symptom was fixed correctly on the first attempt (poll `useBorrowerLoans`'s reads,
add a `closed` check to `RepayForm`). The balance-drain symptom went through a wrong turn first:
the initial fix removed `validationError` from `RepayForm`'s `disabled` gate entirely, letting the
REPAY button submit even against a known-insufficient balance and deferring to the contract's own
revert. That "worked" (the target scenario passed) but was the wrong fix — see
[e2e race fixes should sync the test, not weaken app validation](../workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md)
for why, and for the corrected approach (poll `balanceRead` too, and fix the test's synchronization
instead of the app's validation).

## Solution

`useBorrowerLoans`'s `reads` query gained `refetchInterval: 2_000`
(`web/hooks/useBorrowerLoans.ts:16-31`):

```ts
const reads = useReadContracts({
  contracts: lending && borrower ? ids.flatMap((id) => [...]) : [],
  query: {
    enabled: isConfiguredAddress(lending ?? null) && Boolean(borrower) && ids.length > 0,
    refetchInterval: 2_000,
  },
});
```

`RepayForm`'s not-found check now also treats a `closed` loan as not found — but only when this
form's own repay isn't what just closed it, so a user's own full repay still shows `CONFIRMED`
instead of flashing `LOAN NOT FOUND` on the same refetch that picks up its own success
(`web/components/ActionModal.tsx:1476-1485`):

```ts
if (borrowerLoans.isLoading) {
  return <div className="label mono">LOADING</div>;
}
if (!loan || (loan.closed && !actionTx.isConfirmed)) {
  return <div className="label mono status-negative">LOAN NOT FOUND</div>;
}
```

`balanceRead` got the same treatment (`web/components/ActionModal.tsx:1443-1453`):

```ts
const balanceRead = useReadContract({
  address: market.ovrfloToken,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: connectedAddress ? [connectedAddress] : undefined,
  query: { enabled: Boolean(connectedAddress), refetchInterval: 2_000 },
});
```

`RepayForm`'s `disabled` and `validationError` computation (`web/components/ActionModal.tsx:1468-1471`)
were left as originally written — the fix here is entirely "make the read notice reality," not
"stop trusting the read."

## Why This Works

`useBorrowerLoans` is only ever mounted while the repay modal is open (its single caller is
`RepayForm`), so polling it costs nothing when the modal is closed. 2 seconds comfortably clears
within the suite's 15-second caption-assertion timeout (`web/tests/e2e/steps/common.ts`'s
`"I see the caption"` step), while staying well under the wall-clock scale of a user actually
reading the modal. The `closed`-but-not-`actionTx.isConfirmed` guard distinguishes "someone else
closed this loan" (show not-found) from "I just closed this loan myself" (show the confirmed
success state already rendered further down the component) — both cases refetch through the exact
same polled query, so without the guard a user's own successful full repay would flash
`LOAN NOT FOUND` for one render before `CONFIRMED` ever had a chance to show.

## Prevention

- A `useReadContract(s)` call with no `refetchInterval` and no write of *its own* to key an
  invalidation off only ever reflects "whatever the world looked like at mount time, or at the
  last time some unrelated write in this session invalidated everything." If the value it reads
  can change from a source with no relationship to this component's own write flow — another
  session, another persona, a permissionless contract function anyone can call, a raw fixture-direct
  mutation in a test — polling is the only mechanism that will ever notice. `staleTime` alone
  (`web/lib/wagmi.ts`) does not cause a background refetch; it only controls whether a *new mount*
  reuses cached data instead of fetching fresh.
- When a read like this backs a "not found" / "no longer valid" state (a closed loan, a settled
  order, a consumed listing), check for the domain object's own "still active" flag directly —
  don't assume "not found" only means the row is literally missing from the read. Many contracts
  (this one included, per `docs/solutions/patterns/ovrflo-critical-patterns.md`-style deliberate
  immutability decisions) never delete closed records, they just flip a flag in place.
  `useBorrowerLoans`'s own read already carried `closed`; the gap was in `RepayForm` never checking
  it, not in the read itself.
- Guard any "closed"/"not found" short-circuit against the case where *this component's own* write
  is what caused the transition, or a legitimate own-action success state can get pre-empted by the
  same short-circuit before it ever renders.

## Related Issues

- [e2e race fixes should sync the test, not weaken app validation](../workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md) —
  the meta-lesson from the balance-drain half of this fix: the first attempt at making the
  "drained mid-flow" scenario pass weakened `RepayForm`'s real validation instead of fixing the
  test's synchronization, contradicting established precedent in the same session. That doc covers
  why the correction matters and how to tell the two situations apart.
- [Borrow-form stale-liquidity E2E scenario races the approve-tx's own invalidateAllOnChainReads refetch](../test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md) —
  the sibling out-of-band-fixture-mutation race for `BorrowForm`, fixed entirely on the test side
  (wait for a UI-observable signal before injecting the mutation) because `BorrowForm`'s disable
  gate there was a *correct*, single-shot, invalidation-driven check — not a case needing polling,
  since the app's own approve-tx invalidation was already the right trigger.
- [useTxQueue treated a mined-but-reverted claim as confirmed](../logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md)
  and its `useWriteFlow` follow-up — different bug (trusting `receipt.isSuccess` over
  `receipt.data.status`), same neighborhood of code (`RepayForm`'s `actionTx`/`approveTx` come from
  the same `useWriteFlow` these docs fixed).
