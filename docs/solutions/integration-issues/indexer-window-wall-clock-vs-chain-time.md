---
title: Wall-clock-anchored indexer window excluded every borrow on the local fork
date: 2026-07-27
category: integration-issues
module: web
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "Demand column showed NO LOANS IN 30 DAYS immediately after a real borrow was confirmed and indexed"
  - "Ponder had the BorrowerLoanPoolCreated row, but the windowed query returned nothing"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [ponder, indexer, time-window, chain-time, anvil-fork, borrow-demand, wagmi, useBlock]
related_components: [OVRFLOLending, Ponder]
---

# Wall-clock-anchored indexer window excluded every borrow on the local fork

## Problem

The ticket-09 borrow-demand column filters indexed `borrow_events` to a trailing
30-day window. The first implementation anchored the window to wall-clock time
(`Date.now()`). On the local anvil fork — pinned to a mainnet block whose
timestamp lags months behind the wall clock — every freshly indexed borrow fell
outside the window, so the column reported an honest-looking zero that was wrong.

## Root cause

Event timestamps come from **chain time** (`event.block.timestamp`); the cutoff
came from **wall time**. Those clocks agree on mainnet but diverge arbitrarily on
forks, testnets, and any lagging chain. `cutoff = wallNow - 30d` can then sit
*after* every indexed event, silently emptying the window. The live end-to-end
fork check (real borrow → indexed within one poll → windowed query) is what
caught it — unit tests all passed because they supplied a consistent `nowSeconds`.

## Solution

Anchor the window to the chain's own clock ([useBorrowDemand.ts](../../../web/hooks/useBorrowDemand.ts)):

```ts
// The trailing window anchors to CHAIN time, not wall-clock time — on a
// local fork (or a lagging testnet) the two diverge by months.
const block = useBlock({ query: { staleTime: 30_000 } });
const nowSeconds = block.data?.timestamp;
// enabled: … && nowSeconds !== undefined   (never falsely "ok" before the block loads)
```

The fetch and the pure aggregation both use this chain-anchored `nowSeconds`;
a block-read error maps to the `unavailable` state, not a fake zero.

## Prevention

- **Any cutoff compared against `block.timestamp` must itself derive from chain
  time.** Wall-clock time is only valid for UI concerns that never touch indexed
  or on-chain timestamps (e.g. the maturity clock compares against `expiryCached`,
  which is also chain-denominated but far enough away that drift is immaterial —
  window arithmetic is where months of fork lag bite).
- **Run the honest-degradation states end to end, not just in units.** The
  unreachable-vs-zero distinction only survives if the fetch layer throws on
  unreachable instead of collapsing to `[]`; a live check on the fork exercises
  the full path (event → index → windowed query) and catches clock-domain
  mismatches that consistent-clock unit tests structurally cannot.
