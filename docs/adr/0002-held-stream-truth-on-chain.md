# ADR-0002 — Held-stream truth is on-chain

Date: 2026-08-15
Status: accepted

## Context

Held-stream discovery lived under `projection.stream`: a browser log-scan
built a candidate id set, then `useStreams` hydrated survivors into
`chain.stream-truth`. Projection rules forbade feeding that candidate set
into gates, and a previously ready set past an explicit age bound had to be
discarded rather than shown behind a warning.

U8 replaces log-scan with Enumerable reads on the OVRFLOStream deployment
(`balanceOf` → `tokensOfOwnerIn` → batched `ownerOf` / `getStream` /
`withdrawableAmountOf` / `statusOf`). The candidate projection key and its
writers (`stream-discovery.ts`, `log-scanner.ts`, scan checkpoints) go away.
Held-stream emptiness and unavailability become properties of the on-chain
book alone.

## Decision

1. **Trust domain.** Held-stream id list and hydrated stream state are
   `on-chain` (`chain.stream-truth`). `projection.stream` and
   `query.streams.candidates` / `query.streams.truth` are retired.
2. **Discard bound.** The projection rule “a previously ready set past its
   bound is discarded, not shown behind a warning” moves to
   `chain.stream-truth` / freshness: `dataUpdatedAt` threads into
   `FreshnessInput`; past `maxAgeMs` the lens treats the set as discarded
   (`signingAllowed` false and no stale-success caption).
3. **Per-lens freshness.** Caption and `signingAllowed` are computed per
   lens (streams / borrowed / supplied), not as a merge of every source.
4. **Cadence.** Held streams and pledged-stream reads (`useLoanStreams`)
   both use `READ_INTERVAL_MS` (15s) via `readQuery`. Fixed `getStream`
   fields cache after first success; the ticker stays local-clock math.

## Consequences

Maps under `docs/maps/state/keys/` drop projection writers for streams.
Invalidation after deposit/borrow/claim hits wagmi keys that mention
`SABLIER_LOCKUP_ADDRESS` (R9 name unchanged). U9 paints the ledger card
from hydrated on-chain state only.
