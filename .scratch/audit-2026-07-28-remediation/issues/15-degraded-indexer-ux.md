# 15 — Degraded-indexer UX

**Category:** feature (resilience)

**Covers:** R43, R44, R45 (Tranche 5 — Indexer trust and races). Findings: none numbered directly, part of the F1 "Degraded stream view" flow.

**What to build:** When the indexer is unreachable, the positions view degrades gracefully instead of breaking: cached stream data (if any) renders behind a staleness indicator while continuing to hydrate from Sablier; with no cache, an explicit unavailable state points to the direct-contract recovery route. Liquidity positions, loans, and borrow ladder depth are entirely unaffected, because they no longer depend on the indexer at all (see ticket 06).

**Details — this is flow F1 from the plan:**
- Trigger: a user loads the positions view while the indexer is unreachable.
- With a cached stream set available: render it behind a visible staleness indicator, keep hydrating each entry from Sablier (using ticket 14's mechanism), drop any entry whose on-chain recipient no longer matches the connected address, discard the cache past a stated maximum age, and keep stream actions enabled throughout — contracts validate each action on submission regardless of indexer state.
- With no cached set available: render an explicit unavailable state naming the direct-contract recovery route — never an empty list, which would read as "you have nothing" rather than "we can't tell you right now."
- Liquidity positions, loans, and ladder depth must render normally throughout, since (post-ticket-06) they're read from the protocol, not the indexer.

**Acceptance criteria:**
- [x] AE7: indexer unreachable, stream set previously loaded — streams appear behind a staleness indicator with contract-hydrated values; liquidity positions, loans, and ladder depth render normally
- [x] AE8: indexer unreachable in a fresh session with no cached stream set — the stream section shows an explicit unavailable state naming the direct-contract recovery route rather than an empty list
- [x] Cache is discarded past a defined maximum age (value decided and documented in the PR)
- [x] Stream actions stay enabled during indexer-unreachable states; contract-level validation is the safety net
- [x] New unit and E2E coverage for both the cached and no-cache degraded paths

**Out of scope:**
- The hydration mechanism itself (ticket 14, this ticket depends on it)
- Ladder/position availability during indexer outage (already guaranteed by ticket 06, this ticket just verifies it holds)

**Blocked by:** 06 (ladder/position reads must already be off the indexer for R45 to hold), 14 (needs the Sablier-hydration mechanism to build the degraded-cache behavior on top of).

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 5, Key Flow F1).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Two real blockers here, not just sequencing preference — R45's claim ("ladder depth remains available while indexer is down") is only true after ticket 06 lands, and the hydration behavior this ticket describes literally is ticket 14's mechanism.

**2026-07-29 (implemented):** Landed as U15 on branch `fix/audit-2026-07-28-tranche-1`.

There is now one distinction the code did not previously make: **stale** and **unavailable** are different states, and neither is an empty list.

*The bug underneath R44.* `fetchHeldStreamIds` returned `[]` when the indexer was unconfigured, which is indistinguishable from "this user holds no streams" — so the failure mode R44 exists to prevent was the *default* behaviour, not an edge case. It throws now, matching `fetchBorrowDemand`, which already threw for exactly this reason. The test that pinned the old behaviour was named "collapses an unconfigured indexer to an empty array"; it now asserts the throw.

*Stale (R43).* Discovery failing with a usable cached set: cards render behind a staleness indicator, every value hydrated from Sablier by U14's mechanism, and actions stay enabled. Blocking them would reproduce the H-5 harm — a user unable to reach their own withdraw path through the app — and the contracts validate each action at submission regardless.

*Unavailable (R44).* No cached set, or one past its maximum age: the view names the direct-contract recovery route with the Sablier address, rather than rendering an empty list. Stream withdrawals never depended on this app, and a user cut off from the UI needs telling that rather than being left to assume their funds are stuck.

*Two decisions the plan left open, now settled.* Maximum cache age is 10 minutes — past that the set is discarded rather than shown behind a warning, because an hour-old list is not "slightly stale", it is a different picture of the user's holdings. And the cache is the in-memory query cache only, deliberately not persisted: persisting would put one address's stream set at rest in a possibly-shared browser, and the on-chain recipient re-check protects what renders, not what sits on disk. A reload paying one discovery round trip is the cheaper trade.

*R45 reduced to a regression guard*, as expected once U5/U6 were descoped. Liquidity, loans and ladder depth are on-chain reads and never depended on the indexer, so the requirement already held — the test locks it in rather than building anything.

Verification: 428 unit tests (up from 423), 32 E2E scenarios, lint, `tsc --noEmit`, and the a11y sweep clean.
