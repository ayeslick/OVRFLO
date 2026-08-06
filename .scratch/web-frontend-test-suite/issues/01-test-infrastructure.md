# 01 — Test infrastructure (Playwright + playwright-bdd + coverage)

**What to build:** Add Playwright and `playwright-bdd` for E2E/Gherkin, and `@vitest/coverage-v8` for informational unit-test coverage. No test content yet — this ticket is purely the tooling and config that every other ticket in this effort depends on for its E2E half.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `@playwright/test`, `playwright-bdd`, `@vitest/coverage-v8` added as dev dependencies in `web/package.json`
- [x] `web/playwright.config.ts` configures `defineBddConfig({ features: 'tests/e2e/**/*.feature', steps: 'tests/e2e/steps/**/*.ts' })`
- [x] `test:e2e` (`bddgen && playwright test`) and `test:e2e:ui` (Playwright UI mode) scripts added
- [x] `web/tests/e2e/README.md` documents the E2E prerequisite: a local Anvil fork seeded via `npm --prefix web run bootstrap:local`, run non-interactively with `BOOT_NO_UI=1` so the script doesn't `exec` into a foreground dev server
- [x] README explicitly notes CI wiring for `bootstrap:local`/`test:e2e` is deferred and low priority — not this ticket's (or this effort's) job; this repo has no CI workflow configuration today
- [x] vitest coverage configured for `web/lib/` and `web/hooks/`, excluding `lib/generated.ts` and `lib/wagmi.ts`; advisory only (reported in the PR diff), not a CI gate, no per-file threshold
- [x] `npx playwright install` succeeds
- [x] `npm --prefix web run test:e2e` runs without config errors (zero scenarios written yet is fine — exits 1 with "No tests found", which is the expected zero-scenario state)
- [x] `npm --prefix web run test -- --coverage` reports a number (73.16% statements at time of writing)

See plan Unit U1 (R1, R2, R3) in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

Implemented in commit `8b34589`. `/mattpocock-skills:code-review` (Standards + Spec axes, parallel subagents)
ran clean on Spec; Standards flagged 6 items, addressed before commit:

- Added `test:e2e`/coverage mentions to `AGENTS.md` (local-only, untracked file — not part of the commit, but
  updated on disk for future sessions).
- Documented `E2E_BASE_URL` in `tests/e2e/README.md` rather than `web/.env.example` — it's a Playwright-runner
  variable, not one of the app's `NEXT_PUBLIC_*` runtime knobs the `.env.example` header scopes itself to.
- Config now hardcodes `workers: 1` (no `fullyParallel`) instead of shipping `fullyParallel: true` against a
  plan that documents shared-fork snapshot/revert isolation (KTD7) — see README rationale.
- Removed the `CI`-conditional `forbidOnly`/`retries` branches — speculative generality against a CI that KTD8
  explicitly defers; add them back if/when CI wiring actually lands.
- `test:e2e`/`test:e2e:ui` now chain through the existing `pretest` gate (typegen + banned-patterns) so E2E
  can't run against stale generated ABIs.
- Playwright's `webServer` option (to auto-start the dev server) was considered and explicitly deferred to
  Ticket 05 — noted in the README rather than silently dropped, since `bootstrap-local.sh`'s `exec` behavior
  makes the seed/serve lifecycle non-trivial to wire correctly before any real scenario exists to validate it.
