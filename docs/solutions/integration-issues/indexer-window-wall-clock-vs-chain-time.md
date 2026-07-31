---
title: Wall-clock-anchored demand window excluded every borrow on the local fork
date: 2026-07-27
category: integration-issues
module: web/hooks/useBorrowDemand.ts, web/lib/demand.ts
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "Demand column showed NO LOANS IN 30 DAYS immediately after a real borrow was confirmed"
  - "Borrow events existed in the demand projection, but the windowed aggregation returned nothing"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [discovery, time-window, chain-time, anvil-fork, borrow-demand, wagmi, useBlock]
related_components: [OVRFLOLending]
---

# Wall-clock-anchored demand window excluded every borrow on the local fork

## Problem

The ticket-09 borrow-demand column filters borrow events to a trailing 30-day
window. The first implementation anchored the window to wall-clock time
(`Date.now()`). On the local anvil fork — pinned to a mainnet block whose
timestamp lags months behind the wall clock — every freshly observed borrow fell
outside the window, so the column reported an honest-looking zero that was wrong.

(Originally the events came from a Ponder indexer; after the on-chain discovery
cutover they come from `useBorrowDemandProjection`. The clock-domain bug is
independent of that transport.)

## Root cause

Event timestamps come from **chain time** (`event.block.timestamp`); the cutoff
came from **wall time**. Those clocks agree on mainnet but diverge arbitrarily on
forks, testnets, and any lagging chain. `cutoff = wallNow - 30d` can then sit
*after* every event, silently emptying the window. The live end-to-end fork check
(real borrow → projection → windowed aggregation) is what caught it — unit tests
all passed because they supplied a consistent `nowSeconds`.

## Solution

Anchor the window to the chain's own clock ([useBorrowDemand.ts](../../../web/hooks/useBorrowDemand.ts)):

```ts
// The trailing window anchors to CHAIN time, not wall-clock time — on a
// local fork (or a lagging testnet) the two diverge by months.
const block = useBlock({ query: { staleTime: 30_000 } });
const nowSeconds = block.data?.timestamp;
// status stays "loading" until nowSeconds is defined; block errors map to
// "unavailable", never a fake-ready zero.
```

`aggregateDemand` in `web/lib/demand.ts` re-filters with the same
chain-anchored `nowSeconds`; a block-read or projection failure maps to the
`unavailable` state, not a fake zero.

## Prevention

- **Any cutoff compared against `block.timestamp` must itself derive from chain
  time.** Wall-clock time is only valid for UI concerns that never touch
  on-chain timestamps (e.g. the maturity clock compares against `expiryCached`,
  which is also chain-denominated but far enough away that drift is immaterial —
  window arithmetic is where months of fork lag bite).
- **Run the honest-degradation states end to end, not just in units.** The
  unreachable-vs-zero distinction only survives if the projection layer keeps
  unavailable distinct from ready-empty; a live check on the fork exercises the
  full path (event → projection → windowed aggregation) and catches clock-domain
  mismatches that consistent-clock unit tests structurally cannot.
