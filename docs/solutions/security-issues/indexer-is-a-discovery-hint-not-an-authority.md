---
title: The indexer is a discovery hint, not an authority — and empty is not "cannot ask"
date: 2026-07-29
category: security-issues
module: web/hooks/useHeldStreams.ts, web/lib/ponder.ts, web/lib/modal-logic.ts
problem_type: security_issue
component: frontend_stimulus
symptoms:
  - "Eligibility for an action was gated on four indexer-supplied fields"
  - "A stream the connected address no longer owns could still be rendered and acted on"
  - "An unconfigured indexer rendered a confident empty portfolio instead of an error"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [trust-boundary, indexer, ponder, sablier, eligibility, fail-closed, degraded-ux]
related_components: [Ponder, OVRFLOLending]
---

# The indexer is a discovery hint, not an authority — and empty is not "cannot ask"

## Problem

Two independent defects with one root: the app treated indexer output as
authoritative.

1. **Eligibility was gated on indexer data.** `isSeriesMatchedStream` decides
   whether a stream can be acted on in a given market, and it checks `sender`,
   `asset`, `endTime`, `canceled`, and `depleted`. Only `withdrawable` was
   hydrated from Sablier; the rest came straight from the indexer. A stale or
   wrong indexer could therefore present an **ineligible stream as eligible**,
   or show one the connected address no longer owns, and the app would let the
   user act on it (finding M-9 / requirement R37).
2. **Unconfigured returned `[]`.** `fetchHeldStreamIds` resolved to an empty
   array when no indexer URL was set. An empty array is indistinguishable from
   "this user holds no streams," so a misconfigured deployment rendered a
   confident, complete-looking empty portfolio (R44).

## Symptoms

- A stream failing the on-chain eligibility conditions could appear actionable
- Ownership was asserted by the indexer rather than checked against Sablier
- With no `NEXT_PUBLIC_PONDER_URL`, the app reported "no streams" rather than
  "cannot reach stream discovery" — the failure mode was the **default**

## What Didn't Work

- **Hydrating only the value being displayed.** `withdrawable` was fetched from
  chain because it is the number on screen. That instinct covers *display*
  correctness and misses *authorization* correctness — the fields nobody renders
  are the ones the gate reads.
- **Returning an empty result on a configuration error.** It makes the unhappy
  path look like a happy path, which is the worst available outcome for a
  portfolio view.

## Solution

**Give the indexer exactly one question to answer.**

```
Indexer:  "which stream ids might be mine?"     — a hint
Chain:    everything else                        — the authority
```

`useHeldStreams` now issues three reads per id — `getStream`,
`withdrawableAmountOf`, `ownerOf` — and **drops any stream whose on-chain owner
is not the connected address**. Naming an id is a hint; it is not a claim of
ownership.

`fetchHeldStreamIds` deliberately returns **ids only**. Returning the indexer's
copy of recipient, sender, asset, end time, or amounts would ship data the
client is required to ignore, and invite a future caller to trust it. Deleting
the data is a stronger guarantee than documenting that it must not be used.

Both fetches now **throw when unconfigured**, so the hook can distinguish three
states — data, empty, and unavailable — and render the third as a degraded view
rather than as emptiness.

## Why This Works

The trust boundary is the point of it. An indexer is a **convenience over
public data**: it makes discovery cheap, and discovery is the one thing that is
genuinely expensive to do from the client. Everything downstream of discovery is
a direct read the client can afford. So the split is not a compromise between
safety and cost — the cheap answer and the trustworthy answer are the same
answer for every field except *which ids to look at*.

What made this exploitable-shaped rather than merely sloppy is that the untrusted
fields fed an **authorization decision**. Wrong display data misleads; wrong gate
data authorizes. Any field an indexer supplies that reaches a `if (…) allow`
must be re-read from the source of truth, and the cheapest way to enforce that is
to never transport it.

On the second defect: **"empty" and "I could not ask" must never share a
representation.** They lead to opposite user actions — one says "you have
nothing here, move on," the other says "do not trust this screen." A function
that collapses them removes the caller's ability to tell them apart no matter how
carefully the caller is written. Throwing is not defensive noise here; it is the
only way to preserve information the UI needs.

## Prevention

- Enumerate which fields feed a gate. Every one of them is hydrated from the
  authority, not the index.
- Return the *narrowest* shape that satisfies the caller. Data you do not return
  cannot be trusted by accident.
- Never resolve a configuration or transport failure to an empty collection.
  Throw, and let the consumer render "unavailable" distinctly from "none."
- A stale cache is served only within an explicit bound (`MAX_STALE_MS`), after
  which the set is discarded rather than shown behind a warning.

## Related Issues

- [Anchor indexer staleness to chain head](../integration-issues/anchor-indexer-staleness-to-chain-head.md) — the freshness signal that makes a degraded view visible
- [Transferred Sablier NFTs invisible in the web UI](../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md) — why discovery needs an indexer at all
- [PositionList blanket error hides on-chain positions](../ui-bugs/positionlist-blanket-error-hides-onchain-positions.md) — the opposite failure, treating a partial failure as total
