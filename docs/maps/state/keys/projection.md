# Projection keys

Browser-side verified-log projection (`web/lib/discovery/`). This file holds
**stream-candidate discovery only.** Lender books, the rate ladder, borrow
demand, and claim preflight are on-chain views (`chain-reads.md`) — they are
not projections.

Projection answers exactly one question:

```
Projection:  "which stream ids might be mine?"   — a candidate set
Chain:       everything else                       — the authority
```

Two rules apply to every entry here, and both are review-blocking:

- **No projected field may reach an `if (…) allow`.** Wrong display data misleads;
  wrong gate data authorises. Fields that decide eligibility, ownership, or
  emptiness-for-first-run are re-read from Sablier / the lending contract.
- **`empty` and `could not ask` must never share a representation.** They lead to
  opposite user actions: one says "you have nothing here, move on", the other says
  "do not trust this screen". Every projection here resolves to a `ReadOutcome`
  (`web/lib/read-outcome.ts`) whose `status` is `loading` · `ready` · `partial` ·
  `unavailable`, with `freshness` on the two that carry data. A consumer that maps
  anything other than `ready` onto an empty list without also surfacing
  unavailability has reintroduced the defect.

Background: `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`.

Promoting any of these facts to `on-chain`, or letting one feed a gate, is a
trust-domain change: summary ADR required, escalates to the Owner (`../../REVIEW.md`).

Entry format and rules: `README.md`.

---

### `projection.stream`

Candidate Sablier stream IDs that *might* be held by the connected account.

- **trust_domain:** `projection`
- **writers:**
  - `web/lib/discovery/stream-discovery.ts` — `discoverStreamCandidates`: vault `Deposited` origins intersected with recipient Transfer logs
  - `web/lib/discovery/log-scanner.ts` — bounded `eth_getLogs`, chunked, incremental from `persist.scan-checkpoint`
  - `web/hooks/useStreams.ts` — landing U6: owns the TanStack query under `query.streams.candidates`
- **readers:**
  - `web/hooks/useStreams.ts` — landing U6: unwraps the outcome; hydrates survivors into `chain.stream-truth`; derives `unavailable`
  - `web/app/page.tsx` — R12 entry: pending or could-not-ask with zero on-chain books → watch with `UI-WATCH-STREAMS-DEGRADED`, **never** first-run
  - `web/components/watch/Wall.tsx` — landing U7: Streams lens degraded state; does not render candidates as rows
  - `web/components/borrow/SelectStream.tsx` — landing U9: candidate list to hydrate; continue does not authorise
- **notes:** **Fail-closed contract.** Discovery names IDs; it never asserts
  ownership, eligibility, remaining, cancelled, or depleted. No field in this
  key reaches a gate — not `UI-WATCH-BORROW-ROUTE`, not `UI-BORROW-SELECT-STREAM`
  continue, not `UI-FIRST-RUN-SURFACE`, not claim / withdraw / repay / close.

  **Which consumer distinguishes empty from could-not-ask:**
  - `useStreams` (U6) must expose a three-valued outcome (`ready` including
    ready-empty, `loading`, `unavailable` / `partial`) and must not collapse
    non-`ready` onto `[]` without also raising `unavailable`.
  - `web/app/page.tsx` is the entry-gate consumer: first-run renders only when
    positions, loans, **and** stream *truth* are confirmed-empty. Discovery
    pending or could-not-ask while books read zero renders watch +
    `UI-WATCH-STREAMS-DEGRADED` (R12, AE5). Reading only `candidateIds` and
    treating `[]` as "no streams" reintroduces the defect.
  - `UI-WATCH-STREAMS-DEGRADED` is the Streams-lens consumer of incompleteness.
    Pending (`CHECKING STREAMS…`) and could-not-ask stay distinct from each
    other and from empty. Copy must never say "you hold no streams".
  - `UI-BORROW-SELECT-STREAM` keeps `loading` / `ready` / `empty` /
    `unavailable` distinguishable; `UI-BORROW-NO-STREAM` is confirmed-empty
    *truth*, and projection incompleteness must not reach it.

  `unavailable` also absorbs the upstream registry's error and `tooLarge`
  states, so an incomplete vault registry cannot present as "no streams".
  Partial (candidate cap hit) is truncated via `UI-SHELL-TRUNCATION`, not
  ready-empty. A previously ready set may be served past a discovery failure
  only within an explicit bound, after which it is discarded rather than shown
  behind a warning.

### `query.streams.candidates`

Declared TanStack query key for stream-candidate discovery.

- **trust_domain:** `projection`
- **writers:**
  - `web/lib/query-keys.ts` — landing U6: `streamKeys.candidates` factory
- **readers:**
  - `web/hooks/useStreams.ts` — landing U6: registers the discovery query
  - `web/lib/invalidate.ts` — stream-creating writes (deposit) invalidate candidates; loan writes do not treat this key as truth
- **notes:** **Fail-closed.** This key holds the candidate query, not
  eligibility. Invalidating it re-runs the log scan; it must never be the
  resource a write-gate waits on. Distinct from `query.streams.truth`. No
  field in the cached payload reaches an `if (…) allow`. Consumers are the
  same as `projection.stream`: `useStreams` distinguishes empty from
  could-not-ask; `page.tsx` must not treat a missing cache entry as
  confirmed-empty.
