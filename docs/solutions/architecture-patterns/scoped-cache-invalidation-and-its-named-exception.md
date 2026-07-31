---
title: Scope cache invalidation to what a write touched, and name the exception
date: 2026-07-29
category: architecture-patterns
module: web/lib/invalidate.ts, web/hooks/useWriteFlow.ts
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - A confirmed write invalidates React Query / wagmi read caches
  - Refetch cost grows with the number of mounted reads rather than the size of the write
  - A refresh must pick up a change made by someone other than the current user
tags: [react-query, wagmi, cache-invalidation, query-keys, discovery, scoping]
---

# Scope cache invalidation to what a write touched, and name the exception

## Context

Post-write invalidation prefix-matched wagmi's two read roots and refetched
**every mounted read** on any write. A deposit into one market refetched every
other market's rate ladder, every balance, and the whole loan book. Audit
requirement R39 asked for invalidation scoped to what the transaction actually
touched.

## Guidance

**Capture what the write touched on the action (or at submit), then
predicate-match the serialised query key against it.**

Today the live path declares `touchedResources` on the ready action and
refreshes through `buildRefreshPlan` / `refreshQueryResources` (see
`web/hooks/useWriteFlow.ts` and `web/lib/query-resource-registry.ts`). Capture
before confirm — by receipt time the call arguments alone are not enough to
reconstruct every affected read.

Match on the **serialised** key rather than walking wagmi's key shape
(`web/lib/invalidate.ts` `keyMentionsAny`). That shape is not part of wagmi's
public contract, and an address sits at different depths for a single read
versus a batched one:

```ts
const serialised = JSON.stringify(queryKey, (_key, value) =>
  typeof value === "bigint" ? value.toString() : value,
).toLowerCase();
```

Three judgement calls worth carrying forward:

- **A batched `useReadContracts` key is invalidated when it contains *any*
  touched contract.** Splitting the batch to be more precise would cost more
  than the occasional extra refetch.
- **An empty scope must match nothing, not everything.** `keyMentionsAny`
  returns `false` immediately on an empty set. This is the single most
  dangerous line in the file, in both directions — see below.
- **Projection-backed reads need an explicit refresh plan.** Held streams and
  other discovery views live under `projectionKeys` and are refreshed through
  `buildRefreshPlan` / `refreshQueryResources` after writes declare touched
  resources. Tick-scoped `market-depth` resources must also match whole-market
  projection keys (`aprBps` null) — see the related learning. `scheduleHeldStreamsRetry`
  remains as a capped ladder helper against `streamKeys.held`, but live write
  refresh should prefer the resource registry so projection scopes stay coherent.

**Name the unscoped path instead of deleting it.** `useStaleRecovery` fires on
a classified stale-liquidity error caused by *another party's* write. There is
no transaction of ours to scope by, and picking up what someone else changed is
the entire point. `invalidateAllOnChainReads` keeps the broad behaviour, is
named for it, and carries the reason in its docstring.

## Why This Matters

The two failure directions are opposite, and only one of them is loud.

**Too broad** is expensive but visible: a thundering herd of refetches on every
write, obvious in the network panel, degrading steadily as the app grows more
reads. It is a performance bug, and performance bugs get noticed.

**Too narrow is a correctness bug that looks like success.** A read that should
have been invalidated simply keeps serving its cached value — the UI shows a
position the user just closed, a balance they just spent, liquidity that is
gone. Nothing errors. The screen looks right.

This is not hypothetical. An edit to `useWriteFlow` silently failed to apply
during implementation, so `touched` was never populated, the predicate matched
**nothing**, and post-write invalidation did nothing at all — strictly worse
than the broad version it replaced. It was caught only because a unit test
asserted a *count* (3 expected, 2 observed) rather than "invalidate was
called." There is now an explicit test that an empty contract set matches
nothing rather than everything, so both directions are pinned.

Handing the deliberate exception an empty scope would have been the same bug
wearing a tidier name: `useStaleRecovery` would have become a no-op and
reintroduced the liquidity race it exists to recover from, with no error and no
behavioural signal. That is why it is a separately named function rather than a
call with a default argument.

## When to Apply

- Any write-then-refetch path in a wagmi/React Query app
- When a "refresh everything" call is being narrowed — check whether each caller
  has a scope to narrow *to* before assuming it does
- When invalidation depends on projection-scoped discovery reads

## Examples

**Rejected — refetches every mounted read on any write:**

```ts
for (const root of WAGMI_READ_ROOTS) {
  queryClient.invalidateQueries({ queryKey: [root] });
}
```

**Adopted — scoped by predicate:**

```ts
queryClient.invalidateQueries({
  predicate: (query) => query.queryKey[0] === root && keyMentionsAny(query.queryKey, touched),
});
```

**Kept, deliberately** — the other-party case, with the reason attached:

```ts
/**
 * The deliberately unscoped refresh.
 * `useStaleRecovery` fires on a classified stale-liquidity error, which is
 * caused by *another* party's write — there is no transaction of ours to scope
 * by, and the whole point is picking up what someone else changed.
 */
export function invalidateAllOnChainReads(queryClient: QueryClient, user?: Address) { … }
```

## Related

- [Live discovery cutover must keep partial and stale reads fail-closed](../integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md) — freshness for projection-backed views after a write
- [Tick-scoped market-depth refresh must also match whole-market projection keys](../logic-errors/tick-scoped-market-depth-refresh-must-match-whole-market-keys.md) — null `aprBps` keys are aggregates; tick selectors must invalidate them
- [wagmi query-key dedup makes cross-component hook duplication free](./wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md) — why the key shape is what invalidation has to match against
- [repayform loan and balance reads never refetch without polling](../ui-bugs/repayform-loan-and-balance-reads-never-refetch-without-polling.md) — the too-narrow failure, observed
