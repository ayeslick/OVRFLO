# E2E tests

Playwright + [`playwright-bdd`](https://github.com/vitalets/playwright-bdd) run Gherkin `.feature` files as native
Playwright tests against a real, seeded local Anvil fork — no mocked RPC layer.

## Prerequisite: a running seeded fork

E2E tests require a local Anvil fork seeded via:

```bash
BOOT_NO_UI=1 npm --prefix web run bootstrap:local
```

`BOOT_NO_UI=1` is required — without it, `bootstrap-local.sh` `exec`s into a foreground dev server and never
returns control to your shell. This reuses the project's existing seeding script; it is not new infrastructure.

With the fork running (and the dev server pointed at it), run:

```bash
npm --prefix web run test:e2e       # headless
npm --prefix web run test:e2e:ui    # Playwright UI mode, for local debugging
```

By default Playwright targets `http://localhost:3000`; override with `E2E_BASE_URL` if the dev server runs
elsewhere. This is a Playwright-runner-only variable, not one of the app's `NEXT_PUBLIC_*` runtime knobs, so it
lives here rather than in `web/.env.example`.

**Why not Playwright's `webServer` option to auto-start the dev server:** `bootstrap-local.sh` `exec`s into a
foreground dev server by default (that's what `BOOT_NO_UI=1` above suppresses), so seeding and serving aren't
cleanly separable into a `webServer` command yet. Revisit this once Ticket 05 has real scenarios to validate the
lifecycle against — auto-starting a server no one has run E2E tests against yet is premature.

**Why `workers: 1`:** every scenario mutates the one shared seeded fork's real chain state. `fork-snapshot.ts`
(below) is expected to make scenarios safe to parallelize via `evm_snapshot`/`evm_revert`, but until that fixture
is built and proven (Ticket 05), serial execution is the correct default — see KTD7 in the plan.

## CI wiring: explicitly deferred, low priority

`test:e2e` is a **local developer command only** right now. This repo has no CI workflow configuration today, and
wiring `bootstrap:local` into CI is a separate, future piece of work — not something this test suite commits to.
If/when that work is picked up, it will additionally need:

- A CI runner with Foundry (`anvil`/`forge`/`cast`) and Docker on `PATH`
- A funded `MAINNET_RPC_URL` archive-RPC secret provisioned in that CI system
- A measured runtime budget for the E2E tier (no prior data point exists yet for this repo's first E2E tier)

See `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md` (R2, KTD8) for the full rationale.

## Structure

- `*.feature` — one file per key journey (see the plan's R10/R11/R12 for the full journey → error-state map)
- `steps/` — step definitions, one file per journey plus `common.ts`
- `fixtures/` — `mock-wallet.ts` (KTD6, E2E-only wagmi mock connector) and `fork-snapshot.ts` (KTD7, per-scenario
  Anvil snapshot/revert isolation)
- `qa-checklist.md` — the handful of pixel-level checks E2E structurally cannot verify

`bddgen` (run automatically by `test:e2e`/`test:e2e:ui`) generates `.features-gen/` from the `.feature` files;
that directory is gitignored per `playwright-bdd`'s own convention and should never be edited by hand.
