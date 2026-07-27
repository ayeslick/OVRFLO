---
title: "useTxQueue leaked scheduleHeldStreamsRetry timers across rapid claims and on unmount"
date: 2026-07-27
category: performance-issues
module: web/hooks/useTxQueue
problem_type: performance_issue
component: frontend_stimulus
symptoms:
  - "Each confirmed transaction in the claim-all queue called scheduleHeldStreamsRetry without cancelling the previous call's pending timers, so two transactions confirming in quick succession ran duplicate 2s/5s retry timers concurrently"
  - "Duplicate concurrent retries caused redundant invalidateQueries calls against the Ponder-indexed held-streams query"
  - "No unmount cleanup existed for the scheduled retry timers, so setTimeout callbacks could still fire after the component unmounted and invalidate queries via a queryClient reference that had outlived its useful scope"
root_cause: memory_leak
resolution_type: code_fix
severity: low
tags: [timer-leak, settimeout-cleanup, usetxqueue, usewriteflow, react-hooks, claim-all, invalidatequeries, cancel-ref-pattern]
---

# useTxQueue leaked scheduleHeldStreamsRetry timers across rapid claims and on unmount

## Problem

`web/hooks/useTxQueue.ts` calls `scheduleHeldStreamsRetry(queryClient, userRef.current)` (`web/hooks/useTxQueue.ts:117-119`) once per confirmed transaction in its receipt-confirmed effect (`web/hooks/useTxQueue.ts:114-130`), but — unlike the pattern already established in the sibling hook `web/hooks/useWriteFlow.ts` — it never stored or cancelled the cleanup function that `scheduleHeldStreamsRetry` returns.

## Symptoms

There was no crash and no failing test; this is a latent leak an engineer would eventually notice as:

- Duplicate/redundant `invalidateQueries` calls on the Ponder-backed "held streams" query when two or more transactions in a single claim-all run confirm within the 2s/5s retry window (`web/lib/invalidate.ts:24` default `delaysMs`) — each confirmed row rearms a fresh batch of timers on top of any still-pending batch from the previous row.
- Timer count for a single claim-all run scaling with the number of confirmed rows rather than staying capped at 2 (`delaysMs.length`, declared at `web/lib/invalidate.ts:24` and consumed at `web/lib/invalidate.ts:28`), since nothing ever cancelled an outstanding batch before scheduling the next one.
- Stray `setTimeout` callbacks firing after the claim-all UI unmounts — e.g. the user navigates away or closes the claim-all modal 1-4s after the last confirmed tx, while a retry timer from that tx is still pending. The callback still runs and calls `queryClient.invalidateQueries` (`web/lib/invalidate.ts:32`) against the app-level `QueryClient` singleton, so nothing throws, but it's work outliving the component's effect-cleanup contract, invalidating a query no mounted component reads anymore.

## What Didn't Work

N/A — this was caught by a code-review pass (`/ce-simplify-code` over `web/*`), not debugged from a live incident or a failing test. There was no prior fix attempt to record.

The originally-written shape was a bare, uncancelled call:

```ts
// web/hooks/useTxQueue.ts — before
invalidateAllOnChainReads(queryClient, userRef.current);
scheduleHeldStreamsRetry(queryClient, userRef.current);
```

This is the same call shape `useWriteFlow.ts` uses internally, but it's insufficient in `useTxQueue.ts`'s calling context: `useWriteFlow`'s effect (`web/hooks/useWriteFlow.ts:19-25`) fires at most once per confirmed write over the hook's lifetime (one hash, guarded by `lastInvalidatedHash`), so even without a cancel-ref there'd only ever be one outstanding batch of timers per mount in the common case. `useTxQueue`'s receipt-confirmed effect fires once per **row** in the queue — potentially many times across a single claim-all run — so a bare call re-arms a brand-new batch of retry timers on every confirmed row while any timers from the previous row's batch are still ticking.

**(session history)** Tracing back through the session that originally wrote both hooks: `scheduleHeldStreamsRetry` and the cancel-before-reassign pattern were introduced together in `useWriteFlow.ts` as part of a "data-layer-fixes" ticket, replacing broken per-form invalidation lists with the shared `invalidateAllOnChainReads` helper. `useTxQueue.ts` was written from scratch roughly 25 minutes later in that *same* session (a separate "claim-all queue" ticket), after the cancel-ref machinery already existed in `useWriteFlow.ts`. The new hook and its test file passed a green test run and an automated two-axis (Standards + Spec) code review before commit, but neither the same-session authorship (with the correct pattern already in front of the author) nor the automated review caught the missing `cancelRetry` ref — the only post-review fix recorded for that batch was an unrelated dead-branch cleanup elsewhere. Nothing in that session shows the omission being scoped out deliberately; it reads as an oversight, not a decision.

## Solution

Added the same three-part cancel-ref lifecycle that `useWriteFlow.ts` already used, copied into `useTxQueue.ts`:

```ts
// web/hooks/useTxQueue.ts:38 — declare the ref alongside the hook's other refs
const cancelRetry = useRef<(() => void) | undefined>(undefined);
```

```ts
// web/hooks/useTxQueue.ts:117-119 — inside the receipt-confirmed effect,
// cancel any still-pending batch before arming a new one
invalidateAllOnChainReads(queryClient, userRef.current);
cancelRetry.current?.();
cancelRetry.current = scheduleHeldStreamsRetry(queryClient, userRef.current);
```

```ts
// web/hooks/useTxQueue.ts:132 — dedicated unmount-cleanup effect
useEffect(() => () => cancelRetry.current?.(), []);
```

This exactly mirrors the existing, already-correct pattern in `useWriteFlow.ts`:

```ts
// web/hooks/useWriteFlow.ts:12 (declare) / :23-24 (cancel-before-reassign) / :27 (unmount cleanup)
const cancelRetry = useRef<(() => void) | undefined>(undefined);
// ...
cancelRetry.current?.();
cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
// ...
useEffect(() => () => cancelRetry.current?.(), []);
```

`scheduleHeldStreamsRetry` itself (`web/lib/invalidate.ts:21-36`) is unchanged — it already returned a disposal function (`() => timers.forEach((timer) => clearTimeout(timer))`, `web/lib/invalidate.ts:35`); the bug was entirely on the caller side of that contract.

Verified via `tsc --noEmit`, `eslint`, and the full `vitest` suite passing after the change. No existing test exercised the leak directly — this was a code-review catch, not a test failure, so no regression test was added for this specific fix.

## Why This Works

`useWriteFlow`'s receipt-confirmed effect runs, functionally, once per hook lifetime for its one write — a single-shot flow where "call the helper once, clean up on unmount" is nearly sufficient on its own even without the cancel-ref, because there's rarely a second call to race against. `useTxQueue`'s receipt-confirmed effect (`web/hooks/useTxQueue.ts:114-130`) is structurally different: it's the advance-the-queue effect, so it runs once per confirmed row, and a claim-all run can confirm many rows within seconds of each other. Any side effect inside a per-row effect that returns a disposable resource (a timer batch, a subscription, an `AbortController`, etc.) must be explicitly cancelled before being re-armed — otherwise every re-run of the effect leaks whatever the previous run started. This is the same discipline `useEffect`'s built-in cleanup provides automatically for the effect's own re-runs; `scheduleHeldStreamsRetry`'s returned cleanup is that same contract surfaced manually, because the "effect" it disposes (a batch of `setTimeout`s) lives inside a plain helper function rather than a `useEffect` itself. The dedicated unmount-cleanup effect then closes the other half of the contract: whatever the *last* row's run left pending must also be cancelled when the component goes away, exactly as `useWriteFlow.ts` already does.

## Prevention

- **Cancel-before-reassign is mandatory at every call site, not just the first one.** Any hook that wraps a shared helper returning a cleanup/dispose function (a timer batch, an event subscription, an `AbortController`) must: (1) hold the last-returned cleanup in a `useRef`, (2) call it immediately before invoking the helper again, and (3) call it again in a dedicated unmount effect (`useEffect(() => () => ref.current?.(), [])`). This is the same shape as "cancel the previous `AbortController` before firing a new fetch" — a helper that hands back a cleanup is asking for the same treatment, whether it's called once per component lifetime or, as here, once per row in a queue.
- **Grep for existing callers before wiring up a new one.** `scheduleHeldStreamsRetry` already had exactly one correct caller (`useWriteFlow.ts`) at the time `useTxQueue.ts` was written in the same session, ~25 minutes later. A quick `grep -rn "scheduleHeldStreamsRetry" web/` before adding a second call site would have surfaced the existing cancel-ref pattern immediately — worth doing any time you're about to be the *second* caller of a helper that returns a resource to manage.
- **Don't rely on same-session authorship or automated review alone to catch this class of bug.** Per session history, the author had the correct pattern in front of them minutes earlier in the same session, and the new hook still passed an automated two-axis code review — neither caught the gap. Treat "does every caller of this cleanup-returning helper cancel-before-reassign and clean up on unmount?" as a standing, explicit review question for any helper of this shape, not a one-time check that a correct first caller satisfies for good.

## Related Issues

- `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md` — the architecture writeup for this exact subsystem (`useTxQueue.ts`, `useWriteFlow.ts`, `invalidate.ts`); it documents the sequential-queue and shared-invalidation design but not the `scheduleHeldStreamsRetry` cleanup lifecycle. A `/ce-compound-refresh web-markets-outcome-first-planners-and-tx-queue` pass could add a short cross-reference to this fix.
