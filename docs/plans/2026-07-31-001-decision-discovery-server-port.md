# Decision: port browser discovery to a same-code server

**Status:** decision pending (Jay)
**Context date:** 2026-07-31, immediately after plan 005 tickets 09–11 landed on `codex/feat-onchain-liquidity-discovery`.

## Where things stand

Plan 005's cutover is done and verified: the frontend discovers liquidity,
loans, held streams, and demand via browser-side verified-log projection
(`web/lib/discovery/live-projection.ts`) plus direct contract hydration.
`gatherLiquidity` is removed from `OVRFLOLending`; Ponder/Envio are deleted;
local bootstrap and E2E run with no backend (full suite 32/32 in ~40s).

Ticket 09 closed with explicit amendments: the R39 performance-ledger
campaign (30 runs × two throttled client profiles ×
1,200-position/15,000-stream fixture, re-run per release and whenever history
doubles), the 10-ETH valid-history churn benchmark, the runtime attempt/byte
budget enforcement (review finding #12), direct-ID recovery, and transport
forward-roll evidence were all **deferred pending this decision** — every one
of them polices in-browser scan cost. Ticket 12 (CI/release evidence) is
deferred for the same reason.

## The question

Keep discovery in the browser (and pay the R39/attacker-cost/budget
obligations), or run the **same projection code** in a small server that
scans once and serves candidate hints, with the browser keeping direct
hydration as the only authority for anything shown or executed.

Key fact: the discovery layer is pure TypeScript over an abstract
`ProjectionReadClient`. The Playwright fixtures already run
`discoverMarketLiquidity`/`discoverHeldStreams` in plain Node today. A server
port reuses the audited code — including the reorg-safe checkpointing from
ticket 03 — rather than reintroducing a second implementation the way Ponder
was.

## Options

### A. Browser-only (status quo)

- **Keeps:** zero infrastructure; fully static IPFS-deployable frontend;
  chain is the only dependency.
- **Costs:** build the R39 ledger tooling from scratch (none exists — only a
  shape test for the contract JSON); permanent per-release ledger reruns;
  attacker-cost benchmark; versioned attempt/byte budget enforcement in the
  scanner; every browser needs a capable historical RPC
  (`NEXT_PUBLIC_HISTORICAL_RPC_URL`), meaning a paid provider key shipped in
  a public bundle with origin/cap management; scan cost grows with history
  forever; adversarial valid-history churn is a live griefing surface with a
  pre-registered 10 ETH stop decision.

### B. Same-code discovery server (recommended direction)

A thin Node service running the existing projection loop against one RPC,
persisting checkpoints, serving candidate IDs/projections over HTTP. The
browser treats the response exactly as it treated Ponder under the standing
doctrine (`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`):
hints only, verified by direct hydration before display or execution.

- **Keeps:** zero-trust properties (server lies are caught by hydration);
  exact semantic parity with the audited scanner; the degradation path —
  browsers still contain the same discovery code and can self-scan from a
  published checkpoint if the server is down.
- **Removes:** the entire R39/attacker-cost/budget obligation set (scan cost
  stops being user-facing); the public archive-RPC key problem (server holds
  the one key); cold-session scan latency; the per-user cost of history
  growth.
- **Adds:** one service to run and supervise (persistence, API, CSP entry,
  deploy story) — the thing the original plan was avoiding.
- **Design note:** Claim All's two-provider corroboration should treat the
  server as *one* candidate source corroborated against a direct browser-side
  check — not both sources.

### C. Off-the-shelf indexer again (Ponder/Graph)

Rejected as strictly worse than B: reintroduces a second implementation of
event semantics that just spent three tickets being deleted, without saving
meaningful work over B (the projection code already exists and is tested).

## Consequences for outstanding work

- **Ticket 12 (CI/release evidence):** re-scope after this decision. The
  still-valid halves (forge/ABI/lint/unit/static-export CI gates, immutable
  promotion, rollback discipline) fold into the server-port plan; the
  browser-ledger evidence items drop under option B.
- **Ticket 09 amendments:** under B they become permanently superseded (a
  server-side scan-latency check is ordinary ops monitoring, not a
  pre-registered client-profile ledger). Under A they come due, starting
  with building the ledger harness.
- **UI redesign (planned):** orthogonal. All discovery/execution substance
  verified this week lives in `web/lib` + `web/hooks` and survives both the
  redesign and either option.

## If B is chosen — implementation sketch (to be expanded by ce-plan)

1. Extract the projection loop into a service entry point (reuse
   `ProjectionReadClient` over a server-side viem client; persist
   checkpoints; expose `market-liquidity`, `account-loan-book`,
   `held-streams`, `borrow-demand`, `claim-all-candidates` endpoints).
2. Browser adapter: a `ProjectionSource` that consumes server hints and runs
   the existing hydration path unchanged; feature-flag fallback to local
   scanning from the last published checkpoint.
3. Bootstrap/E2E: optionally start the service locally (it reuses the same
   Anvil fork); E2E asserts hint/hydration disagreement fails closed.
4. Release: service deploy story + CSP origin + the re-scoped ticket-12 CI
   gates.
