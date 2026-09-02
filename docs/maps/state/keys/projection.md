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

### `projection.portfolio-candidates`

Log-derived stream, loan, and supply ids from the bounded `getLogs` owner.

- **trust_domain:** `projection`
- **writers:**
  - `web/lib/discovery/portfolio-log-candidates.ts` — only `getLogs` owner for portfolio candidates
- **readers:**
  - `web/hooks/usePortfolioActivity.ts` — activity rows from the same scan
  - `web/components/watch/WatchApp.tsx` — does not route from these counts
- **notes:** Output is display data. It never gates, permits, sizes, or prices an
  action. Action-critical facts are re-read from chain before any wallet prompt.
  Empty and could-not-ask stay distinct: a failed page is partial, never a
  confirmed-empty book. Enumeration via `borrowerLoanCount` / `lenderPositionCount`
  remains the routing authority.

### `projection.activity`

Chain-confirmed Deposited, Borrowed, and Supplied events for `/activity/`.

- **trust_domain:** `projection`
- **writers:**
  - `web/lib/discovery/portfolio-log-candidates.ts` — same scan as candidates; newest-first
  - `web/hooks/usePortfolioActivity.ts` — TanStack query keyed by account, block range, lockup, vaults, and lendings
- **readers:**
  - `web/app/activity/page.tsx` — list only; does not apply the portfolio matrix
- **notes:** Wallet rejection is not a row. Partial history is `INCOMPLETE`. Empty
  renders only after the bounded scan completes with zero rows. Transfers are not
  activity. No field reaches an `if (…) allow`.
