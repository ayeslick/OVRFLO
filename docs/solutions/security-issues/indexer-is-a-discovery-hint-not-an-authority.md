---
title: Stream discovery is a candidate set, not an authority — and empty is not "cannot ask"
date: 2026-07-29
category: security-issues
module: web/hooks/useHeldStreams.ts, web/lib/discovery/live-projection.ts, web/lib/modal-logic.ts
problem_type: security_issue
component: frontend_stimulus
symptoms:
  - "Eligibility for an action was gated on discovery-supplied fields rather than Sablier hydration"
  - "A stream the connected address no longer owns could still be rendered and acted on"
  - "A failed or incomplete discovery path rendered a confident empty portfolio instead of unavailable"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [trust-boundary, discovery, sablier, eligibility, fail-closed, degraded-ux]
related_components: [OVRFLOLending]
---

# Stream discovery is a candidate set, not an authority — and empty is not "cannot ask"

## Problem

Two independent defects with one root: the app treated stream *discovery*
output as authoritative.

1. **Eligibility was gated on discovery data.** `isSeriesMatchedStream` decides
   whether a stream can be acted on in a given market, and it checks `sender`,
   `asset`, `endTime`, `canceled`, and `depleted`. Only `withdrawable` was
   hydrated from Sablier; the rest came straight from the discovery layer (then
   a Ponder indexer). A stale or wrong discovery response could therefore present
   an **ineligible stream as eligible**, or show one the connected address no
   longer owns, and the app would let the user act on it (finding M-9 /
   requirement R37).
2. **Failure collapsed to `[]`.** When discovery was unconfigured or incomplete,
   the held-stream path resolved to an empty array. An empty array is
   indistinguishable from "this user holds no streams," so a misconfigured or
   partial path rendered a confident, complete-looking empty portfolio (R44).

## Symptoms

- A stream failing the on-chain eligibility conditions could appear actionable
- Ownership was asserted by discovery rather than checked against Sablier
- Discovery failure reported "no streams" rather than "cannot reach stream
  discovery" — the failure mode was the **default**

## What Didn't Work

- **Hydrating only the value being displayed.** `withdrawable` was fetched from
  chain because it is the number on screen. That instinct covers *display*
  correctness and misses *authorization* correctness — the fields nobody renders
  are the ones the gate reads.
- **Returning an empty result on a configuration or transport failure.** It
  makes the unhappy path look like a happy path, which is the worst available
  outcome for a portfolio view.

## Solution

**Give discovery exactly one question to answer.**

```
Discovery:  "which stream ids might be mine?"     — a candidate set
Chain:      everything else                        — the authority
```

After the on-chain liquidity discovery cutover, discovery is browser-side
verified-log projection (`web/lib/discovery/`), not a separate indexer service.
`useHeldStreams` loads candidate IDs from that projection, then hydrates each
surviving ID from Sablier (`getStream`, `withdrawableAmountOf`, `ownerOf`) and
**drops any stream whose on-chain owner is not the connected address**. Naming
an id is a hint; it is not a claim of ownership.

Discovery still returns the **narrowest** useful shape — candidate IDs and the
hydration outcomes the UI needs — without treating projected metadata as a
gate. Fields that decide eligibility are always re-read from Sablier.

Projection outcomes are three-valued — ready (including ready-empty), loading,
and unavailable/partial — so consumers can distinguish "no streams" from
"cannot trust this list." Partial or stale projections stay unavailable /
preparing rather than ready-empty (see the live-cutover learning).

## Why This Works

The trust boundary is the point of it. Discovery — whether an indexer or an
on-chain log projection — answers the expensive *which ids?* question.
Everything downstream of discovery is a direct read the client can afford. So
the split is not a compromise between safety and cost — the cheap answer and
the trustworthy answer are the same answer for every field except *which ids to
look at*.

What made this exploitable-shaped rather than merely sloppy is that the
untrusted fields fed an **authorization decision**. Wrong display data
misleads; wrong gate data authorizes. Any field discovery supplies that reaches
a `if (…) allow` must be re-read from the source of truth, and the cheapest way
to enforce that is to never treat projected fields as gate inputs.

On the second defect: **"empty" and "I could not ask" must never share a
representation.** They lead to opposite user actions — one says "you have
nothing here, move on," the other says "do not trust this screen." A function
that collapses them removes the caller's ability to tell them apart no matter how
carefully the caller is written. Fail-closed outcomes are not defensive noise
here; they are the only way to preserve information the UI needs.

## Prevention

- Enumerate which fields feed a gate. Every one of them is hydrated from the
  authority, not the discovery projection.
- Return the *narrowest* shape that satisfies the caller. Data you do not return
  cannot be trusted by accident.
- Never resolve a configuration, transport, partial, or stale discovery failure
  to a ready-empty collection. Keep unavailable / preparing distinct from
  "none."
- A previously ready set may be served past a discovery failure only within an
  explicit bound, after which it is discarded rather than shown behind a
  warning.

## Related Issues

- [Live discovery cutover must keep partial and stale reads fail-closed](../integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md) — post-cutover consumer rules for the same trust boundary
- [Shadow discovery outcomes must be fail-closed discriminated unions](../logic-errors/shadow-discovery-outcomes-must-be-fail-closed-discriminated-unions.md) — the outcome shape that preserves empty vs unavailable
- [Transferred Sablier NFTs invisible in the web UI](../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md) — why discovery must track current ownership, not mint recipients
- [PositionList blanket error hides on-chain positions](../ui-bugs/positionlist-blanket-error-hides-onchain-positions.md) — the opposite failure, treating a partial failure as total
