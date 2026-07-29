---
title: Anchor indexer staleness to chain head, not the user's own last write
date: 2026-07-29
category: integration-issues
module: web/hooks/useIndexerSync.ts
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "A lender who just acquired a stream sees a complete-looking list that omits it"
  - "Staleness indicator never fires for a user whose position changed via someone else's transaction"
  - "Indexer-backed views present partial data as current"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [ponder, indexer, staleness, chain-head, block-lag, sablier, degraded-ux]
related_components: [Ponder, OVRFLOLending]
---

# Anchor indexer staleness to chain head, not the user's own last write

## Problem

Audit requirement R40 specified that indexer-backed views should show a
staleness indicator when the indexer's synced height "lags behind the user's
last confirmed write." Implemented literally, that signal **cannot fire for the
users who most need it.**

## Symptoms

- In a sale fill, the **borrower** signs the transaction. The **lender** who
  just acquired the stream has no write of their own to lag behind, so they see
  a confident, complete-looking stream list that silently omits what they just
  bought.
- Same shape for a borrower whose stream returns via a permissionless
  `closeLoan` — someone else's transaction changed their holdings.
- A user who has never written anything this session has no anchor at all, so
  the view can never report itself stale.

## What Didn't Work

- **Implementing the requirement as written.** It is not that the wording was
  vague; it names a specific anchor, and that anchor is absent in exactly the
  flows where the protocol moves a position between two parties.
- **Falling back to "no write yet means not stale."** That is the silent-success
  failure the indicator exists to prevent.

## Solution

Anchor to **chain head** and compare the indexer's synced block against it
(`web/hooks/useIndexerSync.ts:26`). Ponder's built-in `/status` reports the
synced height, so no new endpoint was needed — it is mounted by the framework
rather than by the app's own Hono router, and survived the API rewrite that
removed the other default mounts.

```ts
const lagBlocks = syncedBlock !== undefined && headBlock !== undefined ? headBlock - syncedBlock : null;

return {
  // Unknown is not stale: a failed status read is its own signal, and the
  // degraded-view states in useHeldStreams already cover discovery failing.
  lagging: lagBlocks !== null && lagBlocks > LAG_TOLERANCE_BLOCKS,
};
```

Tolerance is **5 blocks**. Ponder polls every 2s against ~12s mainnet blocks, so
a one- or two-block lag is the normal resting state; flagging it would train
users to ignore the warning, which is worse than not showing one.

## Why This Works

Chain head **strictly contains** the original requirement rather than replacing
it: a user's own confirmed write is by definition at or behind head, so every
case R40's wording covered is still covered, plus the third-party cases it
could not express.

The generalizable form: **anchor freshness checks to the chain's own clock, not
to a proxy for it.** A user's last write is a proxy for "what has happened" that
is only accurate when that user is the only actor. In a two-sided market they
never are. This repo has now hit the same class of bug from a different angle —
a 30-day demand window anchored to wall-clock time rather than
`block.timestamp` — where the proxy was the host machine's clock instead of the
user's activity.

`lagging` is also deliberately false when the lag is **unknown**. A failed
status read is its own signal and is surfaced separately; conflating "cannot
determine freshness" with "stale" would fire the indicator during every
transient status blip.

## Prevention

- When a requirement anchors to "the user's" action, ask **which user** — in a
  two-sided protocol, check whether the counterparty signs instead.
- Prefer an anchor derived from chain state over one derived from session
  history or host state.
- Pick a lag tolerance from the actual poll and block cadence, and write the
  arithmetic into the comment. A tolerance with no stated derivation gets tuned
  by whoever is annoyed by it next.

## Related Issues

- [Wall-clock-anchored indexer window excluded every borrow on the local fork](./indexer-window-wall-clock-vs-chain-time.md) — the same "anchor to the chain, not a proxy" error, with the host clock as the proxy
- [Scope cache invalidation to what a write touched](../architecture-patterns/scoped-cache-invalidation-and-its-named-exception.md) — the same "whose write is it?" question, answered for invalidation
- [Transferred Sablier NFTs invisible in the web UI](./transferred-sablier-nfts-invisible-WebUI-20260421.md) — the discovery gap this indicator now makes visible instead of silent
