---
title: "Two components calling the same wagmi read hook with identical args isn't wasted network cost — check query-key dedup before 'fixing' it"
date: 2026-07-27
category: architecture-patterns
module: web/hooks
problem_type: architecture_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "An architecture review flags 'component A and component B both call hook H with the same address/id' as duplicated work or a performance problem"
  - "Deciding whether to lift wagmi/react-query-backed state into a parent component, a context provider, or a hoisted-cache hook to eliminate apparent per-component re-fetching"
  - "A sibling or parent/child pair of components each independently call useReadContract/useReadContracts (or any TanStack Query-backed hook) with the same contract address and args"
tags: [wagmi, react-query, tanstack-query, query-key, dedup, react, data-fetching, over-engineering]
related_components: [MarketsTable, PositionList, MarketRowDetail]
---

# Two components calling the same wagmi read hook with identical args isn't wasted network cost — check query-key dedup before "fixing" it

## Context

An architectural review pass over `web/*` flagged `RatesCell` (rendered once per row inside `MarketsTable`) and `PositionList` (rendered inside `MarketRowDetail` when a row expands) as duplicating work: both call `useLending(market.lending)` and `useLendingLiquidity(market.lending)` for the *same* lending address whenever a row is expanded.

```120:125:web/components/MarketsTable.tsx
// R5 RATES: the market's live tick range in both lenses ("10.00%–12.00% APR · 90.2%–94.3% ↑"),
// pure math over enumerated liquidity — zero extra reads beyond the hooks' own.
function RatesCell({ market, nowSeconds }: { market: MarketInfo; nowSeconds: bigint | null }) {
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
```

```50:51:web/components/PositionList.tsx
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
```

The instinctive fix is to treat this like any other duplicated-logic finding: lift the reads into a parent, thread the result down as props, or wrap it in a context/shared-cache hook so "only one component fetches this." That instinct is right for hand-rolled state (see `docs/solutions/best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md`) but wrong here, because the thing being "duplicated" is not actually costing anything.

`useLending` (`web/hooks/useLending.ts:9-21`) and `useLendingLiquidity` are built on wagmi's `useReadContracts`, which is a thin wrapper over TanStack Query's `useQuery`. TanStack Query computes a **query key** from the read's `contracts` array — address + functionName + args + chainId, in order (`abi` is explicitly stripped out before the key is built, per `@wagmi/core`'s `readContractsQueryKey`) — and dedupes *by that key*, not by call site. Two hook invocations — in two entirely different components, mounted at different times, with no shared parent — that resolve to the same `contracts` array collapse to one cache entry and one in-flight request. Every additional call site is an additional *subscriber* to that entry, not an additional network round trip.

Checking this took reading the query-key inputs (both hooks pass the same `lending` address into the same fixed `contracts` array shape, unconditional on which component called them), not re-running the app with network logging — the equality is structural and can be verified by comparing the two hooks' `contracts`/`args` construction directly.

## Guidance

Before proposing a fix for "component A and component B both call hook H with the same arguments":

1. **Identify what H is built on.** If H is a thin wrapper over `useReadContract`/`useReadContracts` (wagmi) or any other TanStack-Query-backed hook, its caching layer already dedupes by query key — verify this is the case rather than assuming duplication is real just because the call sites are duplicated.
2. **Compare the actual query-key inputs at each call site**, not the call sites' surrounding code. If both call sites pass the exact same address/functionName/args (character-for-character equal after evaluation, not just "similar looking" — `abi` doesn't count, since wagmi strips it before building the key), the calls are one cache entry regardless of how many components subscribe to it. If any input differs — different `args`, different `enabled` predicate feeding into a conditional `contracts` array — dedup does not apply and the calls are genuinely independent (see the companion doc on `enabled`-predicate mismatches, linked below).
3. **If dedup applies, don't build anything.** Lifting the read into a parent, adding a context provider, or writing a hoisted-cache hook to eliminate a cost that is already zero adds a real seam (props threading, provider re-render scope, an extra file to maintain) to solve nothing. This is the same "don't hand-roll what a battle-tested library already gives you for free" principle, applied to a case where the library's win is invisible unless you go looking for it.
4. **What duplication does still cost** (and is real, if disproportionate): each call site still runs its own selector/derivation logic over the shared cached data (cheap unless the derivation is unusually expensive — verify per case, don't assume), and each hook instance still has its own subscription bookkeeping (React re-render on cache update; negligible at the scale of a markets table). If *that* cost is the actual concern, it's a much smaller and more surgical fix than "eliminate the duplicate hook calls."

## Why This Matters

- **The fix is worse than the non-problem.** A context provider or hoisted-cache hook introduces a new abstraction, a new place for staleness/invalidation bugs to hide, and a dependency between two components that previously had none — to save zero real requests. That's a net architectural loss dressed up as a cleanup.
- **This is exactly the failure mode `docs/solutions/patterns/ovrflo-critical-patterns.md` pattern #20 (prefer battle-tested libraries) warns about, pointed in the opposite direction.** The usual violation is hand-rolling something a library already solves. Here, the risk is *not trusting* that the library (wagmi/TanStack Query) already solved it, and hand-rolling a solution anyway.
- **"Looks duplicated" is a code-shape heuristic; "is duplicated" is a runtime/cache-key question.** An architecture review that stops at the code-shape level (two components call the same-named hook) will systematically over-flag every cache-backed data hook used in more than one place, because that's the intended, idiomatic usage pattern for TanStack-Query-backed hooks — not an anti-pattern.
- **The existing code already documents this general insight, for a different read pair.** `web/components/MarketsTable.tsx:120-121`'s "zero extra reads beyond the hooks' own" comment is about `RatesCell`'s own `useLending`/`useLendingLiquidity` calls specifically. `web/components/MarketRowDetail.tsx:54`'s "Also read by ConvertForm for capacity display — wagmi dedupes by query key" comment is about a *different* read (`wrappedUnderlying`, shared between `MarketRowDetail` and `ActionModal`'s `ConvertForm`) reaching the same conclusion for a different pair of call sites. Both are prior instances of a team member independently verifying "wagmi dedupes by query key" before trusting it. A review pass that doesn't check for comments like these before flagging cross-component hook duplication risks re-litigating an already-settled call.

## When to Apply

- Reviewing a codebase (manually, or via an `/improve-codebase-architecture`-style pass) for architectural friction, specifically the "N components fetch the same data" smell.
- Any hook built on wagmi's `useReadContract`/`useReadContracts`, or more generally any hook built on TanStack Query, SWR, Apollo Client, RTK Query, or another cache-key-based data layer — all of these dedupe concurrent/overlapping requests by key, not by call site.
- Before adding a context provider, a "shared data layer," or a hoisted/singleton cache specifically to solve a duplication concern for cache-key-based hooks — check whether the concern is real first.

## Examples

**Not a problem — same query key, two components, zero extra requests.** `RatesCell` and `PositionList` each call the identical two hooks with the identical argument:

```120:124:web/components/MarketsTable.tsx
function RatesCell({ market, nowSeconds }: { market: MarketInfo; nowSeconds: bigint | null }) {
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
```

```50:51:web/components/PositionList.tsx
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
```

Both resolve to the same `contracts` array (`web/hooks/useLending.ts:10-19`) for a given `lending` address — one cache entry, one fetch, two subscribers.

**Would be a real problem — same-named hook, different query keys:**

```tsx
// Component A
useReadContract({ address: token, abi, functionName: "balanceOf", args: [userA] });
// Component B
useReadContract({ address: token, abi, functionName: "balanceOf", args: [userB] });
```

Different `args` → different query key → genuinely two requests. Dedup only collapses calls whose full key (address + functionName + args + chainId) matches.

## Related

- [`wagmi-read-batching-requires-matching-enabled-predicates.md`](wagmi-read-batching-requires-matching-enabled-predicates.md) — the opposite-direction case: when *within one component*, several reads that look mergeable actually have diverging `query.enabled` predicates, and merging them (to *reduce* call count) would be the mistake. Read together, the two docs bound the same axis from both sides: don't merge reads whose `enabled` predicates differ (that doc), and don't build machinery to *eliminate* reads whose query keys already match across components (this doc) — in both cases, check the query key / enabled predicate itself rather than trusting code-shape similarity.
- [`shared-hook-safety-depends-on-render-tree-position.md`](shared-hook-safety-depends-on-render-tree-position.md) — a third instance of the same meta-lesson ("before acting on a consolidation/de-duplication instinct, check the actual precondition at each call site, not the code's visual shape") in a third domain: hydration timing instead of cache keys or `enabled` predicates. All three came out of the same 2026-07-27 review passes over `web/*`.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` pattern #20 (prefer battle-tested libraries over hand-rolled code) — this doc is the "don't distrust the library" corollary to that pattern.
- Session-history check (2026-07-27): searched a prior multi-day session (`2026-07-15` – `2026-07-22`, 38 keyword matches on `useLending`/`dedup`/`query key`) that originally built `useLending`/`useLendingLiquidity`/`RatesCell`/`PositionList` for any earlier discussion of hoisting this data across components — found none; the dedup behavior was not previously discussed or debated, only exercised inline via the two code comments cited above.
