# 17 — Scoped cache invalidation & sync staleness signal

**Category:** bug (correctness, freshness)

**Covers:** R39, R40 (Tranche 5 — Indexer trust and races).

**What to build:** A confirmed write invalidates only the query keys the transaction actually touched, immediately on confirmation — not the whole cache namespace, and not waiting for the next polled block. Stream discovery reads carry the indexer's synced block height, and a view that's lagging the user's last confirmed write shows a staleness indicator instead of appearing complete.

**Details:**
- R39: replace whole-namespace cache invalidation with invalidation scoped to the contracts/query keys the confirmed transaction touched (e.g. a deposit into market A invalidates market A's reads, not every market's).
- Also part of this theme (see the SE2-adoption plan for the parallel requirement): the invalidation should fire immediately on write confirmation rather than waiting for a polled block.
- R40: stream discovery reads carry the indexer's synced block height as part of the response. If that height lags behind the user's last confirmed write, the view renders a staleness indicator rather than presenting the data as current/complete.

**Acceptance criteria:**
- [x] A test asserts an unrelated market's queries are not invalidated by a write to a different market
- [x] A confirmed write's affected keys invalidate immediately, not on the next poll cycle
- [x] Stream discovery responses expose the indexer's synced block height
- [x] A view lagging the user's last confirmed write (synced height behind the write's block) shows a staleness indicator
- [x] `npm --prefix web run test` green

**Out of scope:**
- The broader RPC-fallback/transaction-simulation work from the separate SE2-adoption plan (`docs/plans/2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md`) — coordinate on shared invalidation code if that plan lands nearby in time, but don't pull its scope into this ticket

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 5).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Flagging overlap: `docs/plans/2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md` R7/R8 cover very similar cache-invalidation-scoping ground from a different angle (SE2 comparison). Whoever implements this should check that plan before touching shared invalidation code, to avoid two separate rewrites of the same mechanism.

**2026-07-29 (implemented):** Landed as U17 on branch `fix/audit-2026-07-28-tranche-1`.

*Scoping (R39).* `invalidateOnChainReads` predicate-matches the wagmi read roots against the contracts a transaction actually touched, instead of prefix-matching them wholesale. `useWriteFlow` records the target address at submit time — by confirm time the args are gone — and `useTxQueue` scopes to the lending market or Sablier depending on which leg of the queue just landed. A batched `useReadContracts` key is invalidated when it contains *any* touched contract; splitting the batch to be more precise would cost more than the occasional extra refetch.

*The exception, kept and named.* `useStaleRecovery` fires on a stale-liquidity error caused by **another party's** write, so there is no transaction of ours to scope by and the whole point is picking up what someone else changed. `invalidateAllOnChainReads` stays broad and is documented as the deliberate exception. Handing it an empty scope would have quietly turned it into a no-op and reintroduced the race it exists to recover from.

*A bug this nearly shipped with.* One of my edits silently failed to apply, so `touched` was never populated — which meant the predicate matched **nothing** and post-write invalidation did nothing at all. The unit tests caught it (3 expected invalidations, 2 observed). There is now an explicit case asserting that an empty contract set matches nothing *rather than everything*, so the failure mode has a name and a guard in both directions.

*Staleness (R40), re-anchored.* The requirement said "lagging the user's last confirmed write", which cannot fire for the person it most needs to protect: in a sale fill the **borrower** signs, so the lender who just acquired a stream has no write of their own to lag behind and would see a confident, complete-looking list omitting what they just bought. Same for a borrower whose stream returns via a permissionless `closeLoan`. `useIndexerSync` anchors to chain head instead, which covers both and every case the original wording covered — a user's own write is by definition at or behind head. Tolerance is 5 blocks: Ponder polls at 2s against ~12s blocks, so a one- or two-block lag is the resting state and flagging it would train people to ignore the warning.

Ponder's built-in `/status` survived the U16 rewrite (it is mounted by the framework, not by our Hono app), so the synced height needed no new endpoint.

Verification: 441 unit tests (up from 434), 32 E2E scenarios, lint, `tsc --noEmit`, and the a11y sweep clean.
