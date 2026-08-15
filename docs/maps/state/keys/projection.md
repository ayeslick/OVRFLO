# Projection keys

Browser-side verified-log projection (`web/lib/discovery/`). **Held-stream
candidate discovery is retired (U8 / ADR-0002).** Lender books, the rate
ladder, borrow demand, and claim preflight are on-chain views
(`chain-reads.md`) — they are not projections.

Projection previously answered:

```
Projection:  "which stream ids might be mine?"   — retired
Chain:       held streams via Enumerable           — the authority
```

Any remaining projection scopes (if reintroduced later) still follow:

- **No projected field may reach an `if (…) allow`.**
- **`empty` and `could not ask` must never share a representation.**

Background: `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`.
Trust-domain move for streams: `docs/adr/0002-held-stream-truth-on-chain.md`.

Entry format and rules: `README.md`.

---

### `projection.stream` — retired

Candidate Sablier stream IDs from log-scan. **Removed in U8.** Writers
`stream-discovery.ts` / `log-scanner.ts` and keys `query.streams.candidates`
/ `query.streams.truth` are deleted. Held-stream authority is
`chain.stream-truth` only.

The discard-bound rule that lived here (“past the bound, discard — do not
show behind a warning”) now applies to on-chain stream freshness under
`chain.stream-truth` / `web/lib/freshness.ts`.
