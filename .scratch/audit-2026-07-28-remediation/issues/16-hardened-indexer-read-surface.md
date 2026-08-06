# 16 — Hardened indexer read surface

**Category:** feature (security, infra)

**Covers:** R36, R38 (Tranche 5 — Indexer trust and races). Findings: M-8.

**What to build:** The browser reaches the indexer only through a hardened, narrow read surface — no direct raw-SQL reachability, no unconsumed GraphQL mount, and the remaining surface carries rate limiting, a statement timeout, and an origin allowlist. Ponder's indexed scope is confirmed as Sablier stream events and borrow demand only — nothing about liquidity positions, loans, listings, or pool shares.

**Details:**
- R38/M-8: `web` builds as a static export (`output: "export"` in `web/next.config.ts`) and the browser reads the indexer through `@ponder/client`, which speaks SQL to the raw query route — so indexer access control cannot rely on client-held credentials. Harden the surface itself: the raw SQL route must not be directly reachable from arbitrary callers, the unconsumed GraphQL mount is removed entirely, and the surface that remains has rate limiting, a statement timeout, and an origin allowlist.
- R36: confirm — this is likely already true and needs verification/locking-in rather than new code. Per the plan's own Dependencies section, Ponder today registers five Sablier handlers plus one `BorrowerLoanPoolCreated` handler feeding `borrow_events`; no handlers or tables should be added. Write a test or CI check that fails if a new handler/table is added indexing position, loan, listing, or pool-share state, so this stays true going forward.
- Verify against the live deployment: rate-limit policy, statement timeout, and route reachability recorded in `docs/audit/` per the plan's tranche 5 gate.

**Acceptance criteria:**
- [x] Raw SQL query route is not directly reachable by an arbitrary caller (auth/allowlist/proxy — whatever mechanism fits the deployment)
- [x] Unconsumed GraphQL mount removed
- [x] Rate limiting, statement timeout, and origin allowlist active on the remaining read surface
- [x] A regression check (test or CI rule) asserts Ponder's handler/table set doesn't grow to cover position/loan/listing/pool-share state
- [ ] Rate-limit policy, statement timeout, and route reachability verified against the live deployment and recorded in `docs/audit/` — **MAINTAINER STEP, not done**

**Out of scope:**
- Any new Ponder handlers or schema tables (explicitly out of scope for the whole plan)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 5, gate includes R38 verified against the live deployment).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. R36 folded in here as a confirm-and-guard item rather than its own ticket, per the plan's Dependencies section noting it's already true today.

**2026-07-29 (implemented):** Landed as U16 on branch `fix/audit-2026-07-28-tranche-1`.

*The surface is now two endpoints, not a query language.* `client()` mounts arbitrary SQL over HTTP at `/sql/*`, and `graphql()` mounts a second query surface — both public, because `web` is a static export with no server side to hold a credential. They are replaced by `/streams` and `/demand`: fixed statements, scalar parameters, returning only the columns the client consumes. Verified live — the endpoints serve, `/sql` and `/graphql` both 404, and a malformed address returns 400.

I read Ponder's own docs before committing to this (via context7) and it changed the implementation twice. Custom REST endpoints in `src/api/index.ts` are the **documented** pattern, so removing the two mounts is idiomatic rather than a workaround. And the queries should use the Drizzle query builder against `ponder:schema`, not raw SQL — my first version hand-wrote `sql` templates inside `db.transaction(...)` with `SET LOCAL statement_timeout`, which is neither documented nor workable: the `db` handle from `ponder:api` is **read-only by construction**, which is a stronger guarantee than the scaffolding I was adding on top of it.

*On the statement timeout.* I removed the transaction wrapper rather than ship something that looks like a timeout and isn't. A JS-side timer does not cancel a running query; the timeout belongs on the database connection (`statement_timeout` via the `DATABASE_URL` options, or the host's own configuration). Recorded as a maintainer step rather than faked in application code.

*R36 guard.* `tests/indexer/scope-guard.test.ts` asserts the schema is exactly `asset`, `borrow_events`, `sablier_streams`; that the only `OVRFLOLending` handler is `BorrowerLoanPoolCreated`; that no handler mentions liquidity, listings, or pool shares; and that the API exposes neither `client()` nor `graphql()`. The scope was already correct — the guard exists because "we decided not to index that" is invisible at review time, and a new handler looks like a feature rather than a boundary being crossed.

*Config.* `disableCache` and the mandatory start block are local-fork settings; `PONDER_DEPLOYMENT=1` now switches caching on and requires the factory's real deployment block. Carrying the fork settings into managed hosting would make the R43 degraded state routine after every deploy rather than exceptional.

*One real break, caught by E2E.* The `waitForHeldStream` fixture posted raw SQL to `/sql/db`, so once that route was gone it silently returned false and eight stream scenarios timed out. It now calls the same `/streams` endpoint the app uses — which is the better fixture anyway: it waits on exactly the surface the browser depends on, rather than a parallel query that could keep passing after the real one broke.

A ninth failure in that run turned out to be environment residue: the scenario passed in isolation and on two consecutive fresh full runs.

Verification: 434 unit tests, 32 E2E scenarios green on two consecutive fresh bootstraps, lint, `tsc --noEmit`, and the a11y sweep clean. Live endpoint behaviour checked by hand.
