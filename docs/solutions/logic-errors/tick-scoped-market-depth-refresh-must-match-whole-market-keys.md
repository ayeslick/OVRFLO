---
title: Tick-scoped market-depth refresh must also match whole-market projection keys
date: 2026-07-31
category: logic-errors
module: web/lib/query-resource-registry.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "A confirmed supply never refreshed the on-chain liquidity projection"
  - "Tick-scoped market-depth selectors missed whole-market projection cache entries"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [query-resource-registry, market-depth, projection, refresh, cutover]
related_components: [OVRFLOLending]
---

# Tick-scoped market-depth refresh must also match whole-market projection keys

## Problem

Claude's U9 live verification on a seeded fork found that
`refreshQueryResources` never matched tick-scoped `market-depth` selectors
against whole-market projection keys (`aprBps == null`). A confirmed supply
therefore left the projection stale.

## Symptoms

- Post-supply UI still showed pre-write depth until a full remount/refetch
- Deterministic unit suites passed; only live fork evidence exposed it

## What Didn't Work

Exact `aprBps` equality between the touched resource and the cached key.
Whole-market projections intentionally use a null tick and contain every tick.

## Solution

`selectorMatches` treats a null `aprBps` on the cached key as matching any
tick-scoped selector for that market (merged in PR #3):

```96:98:web/lib/query-resource-registry.ts
    // A key with a null aprBps is a whole-market projection; it contains every
    // tick, so any tick-scoped selector staleness applies to it as well.
    (selector.aprBps == null || aprBps == null || aprBps === selector.aprBps) &&
```

## Why This Works

Touched resources name the tick they wrote. Cached projections may be scoped
wider. Refresh must invalidate every cache entry that *contains* that tick,
not only entries keyed to the exact tick.

## Prevention

- Assert in `web/tests/lib/query-resource-registry.test.ts` that a tick-scoped
  `market-depth` resource matches whole-market projection keys (`aprBps` null /
  omitted) — the tick-keyed cases alone do not cover this bug
- When adding projection key shapes, document null-as-aggregate semantics

## Related Issues

- [Scoped cache invalidation and its named exception](../architecture-patterns/scoped-cache-invalidation-and-its-named-exception.md)
- [Live discovery cutover must keep partial and stale reads fail-closed](../integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md)
- Captured from Claude U9 live-gate fixes (merged in PR #3)
