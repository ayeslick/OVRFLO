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

**Markets are discovered live, not hardcoded:** `script/seed-local.sh` forks the live chain head (no
`--fork-block-number` pin), so a specific Pendle market address baked into the script would eventually expire
relative to real wall-clock time — this actually happened once (a hardcoded `PRIMARY_EXPIRY` went stale and the
script's own guard refused to seed anything). Instead, every run queries Pendle's `markets/all` API and picks the
top-2-by-liquidity wstETH markets whose expiry is more than `PENDLE_EXPIRY_BUFFER_DAYS` (default 14) past the
fork's own block timestamp — see `script/lib/discover-pendle-market.sh` for the pure filter/selection logic (unit
tested against a fixture in `discover-pendle-market.test.sh`, no network required) and
`docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md` for the full writeup of why this replaced hardcoded market constants. This
means every scenario in this suite only exercises whichever market seed-local.sh's live discovery labels
"secondary" this run (the lower-liquidity of the two seeded markets — arbitrary, just needs to be a stable pick);
`fixtures/chain.ts`'s `readSecondaryMarket()`/`readSecondaryPt()`/`readSecondaryExpiry()` read it out of
`deployments/local.json` (written by seed-local.sh) rather than any hardcoded address, so nothing here depends on
a specific market staying valid.

The dev server must run with `E2E_WALLET_RUNTIME=1`. That makes Turbopack resolve the `wallet-runtime` module
specifier to `tests/e2e/support/WalletRuntime.tsx` (mock connector, pre-connected as Anvil's account #1, no Reown
AppKit) instead of `components/WalletRuntime.tsx` — the real wallet-connect UI has no automatable "approve" step,
so E2E always signs as a pre-connected mock account.

The seam is **build-time, not runtime**: the app contains no `isE2E` branch, the production bundle contains no test
code, and selecting the E2E runtime requires this command rather than an environment variable a deploy could
inherit. `E2E_WALLET_RUNTIME` is deliberately not `NEXT_PUBLIC_*`, so it is never inlined into client code.

```bash
E2E_WALLET_RUNTIME=1 npm --prefix web run dev
```

With the fork running and the dev server pointed at it (with `E2E_WALLET_RUNTIME=1` set), run:

```bash
npm --prefix web run test:e2e       # headless
npm --prefix web run test:e2e:ui    # Playwright UI mode, for local debugging
```

By default Playwright targets `http://localhost:3000`; override with `E2E_BASE_URL` if the dev server runs
elsewhere. This is a Playwright-runner-only variable, not one of the app's `NEXT_PUBLIC_*` runtime knobs, so it
lives here rather than in `web/.env.example`. Similarly, `E2E_RPC_URL` (default `http://127.0.0.1:8545`) points
`fixtures/rpc.ts`/`fixtures/chain.ts` at the Anvil fork directly, for `evm_snapshot`/`evm_revert` and the arrange
helpers that sign as Anvil's own unlocked dev accounts. Stream arrange waits use the same verified-log projection
and direct Sablier hydration as the live frontend.

**Why not Playwright's `webServer` option to auto-start the dev server:** `bootstrap-local.sh` `exec`s into a
foreground dev server by default (that's what `BOOT_NO_UI=1` above suppresses), so seeding and serving aren't
cleanly separable into a `webServer` command yet.

**Why `workers: 1`:** every scenario mutates the one shared seeded fork's real chain state. `fixtures/fork-snapshot.ts`
is an `auto: true` fixture that wraps every scenario in `evm_snapshot`/`evm_revert`, which is expected to make
scenarios safe to parallelize — but that hasn't been validated against a real fork yet, so serial execution stays
the default per KTD7 in the plan until it has.

## CI wiring: explicitly deferred, low priority

`test:e2e` is a **local developer command only** right now. This repo has no CI workflow configuration today, and
wiring `bootstrap:local` into CI is a separate, future piece of work — not something this test suite commits to.
If/when that work is picked up, it will additionally need:

- A CI runner with Foundry (`anvil`/`forge`/`cast`) and Docker on `PATH`
- A funded `MAINNET_RPC_URL` archive-RPC secret provisioned in that CI system
- A measured runtime budget for the E2E tier (no prior data point exists yet for this repo's first E2E tier)

See `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md` (R2, KTD8) for the full rationale.

## Structure

- `*.feature` — one file per key journey: `supply`, `borrow`, `claim-all`, `adjust-rate`,
  `deposit-wrap-unwrap` (PT deposit, post-maturity claim, wrap, unwrap), `repay-close` (see the plan's R10/R11/R12
  for the full journey → error-state map)
- `steps/` — step definitions, one file per journey plus `common.ts` (navigation, modal/caption/button assertions,
  focus-trap checks — anything reused across multiple journeys)
- `fixtures/` —
  - `mock-wallet.ts` (KTD6): the two Anvil dev-mnemonic addresses the suite signs as, plus a
    `waitForWalletConnected` helper
  - `fork-snapshot.ts` (KTD7): an `auto: true` fixture giving every scenario its own `evm_snapshot`/`evm_revert`
  - `rpc.ts`: a minimal JSON-RPC client for Anvil-specific calls (`evm_snapshot`, `evm_increaseTime`, ...)
  - `chain.ts`: viem `PublicClient`/`WalletClient`s plus **arrange helpers** — direct on-chain calls (lender
    supplies liquidity, a stream gets deposited, a loan gets opened, chain time gets advanced) that set up scenario
    preconditions without going through the UI. This is a deliberate arrange/act split, not a shortcut: the E2E
    mock connector can only ever sign as one address, so a second persona's state (e.g. a lender's liquidity in
    `borrow.feature`) can never be arranged by clicking through the UI as the connected user in the first place.
    Anvil signs for its own unlocked dev-mnemonic accounts without needing a private key in the test runner, so a
    plain viem `WalletClient` constructed with just an `account: Address` works for both personas.
  - `bdd.ts`: binds playwright-bdd's `Given`/`When`/`Then` to the `fork-snapshot.ts` test object, not the bare
    `playwright-bdd` one — this is why `playwright.config.ts`'s `steps` glob must include `fixtures/**/*.ts`, not
    just `steps/**/*.ts` (`bddgen` needs to see this file to find the extended test instance)
- `qa-checklist.md` — the handful of pixel-level checks E2E structurally cannot verify

**Synchronizing fixture-direct writes:** because `chain.ts`'s arrange helpers write directly on-chain, none of the
app's own write-triggered invalidation or refetching fires for them — a later step that depends on the app having
observed a fixture-direct write must synchronize on an app-observable signal, not just on the prior Playwright step
having returned. The default technique is a full reload (`common.ts`'s `Given "the frontend re-syncs with chain
state"` step). When a scenario needs to keep an open modal or other in-page state — so a reload isn't viable —
synchronize on a narrower UI-observable proxy instead (e.g. a button becoming enabled) before performing the
fixture-direct write, so it lands only after the app's own async effects from the prior UI-driven action have
already settled. See
`docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md` for a
worked example of this second technique and the race it fixes.

**On maturity scenarios:** the frontend gates on wall-clock `Date.now()` while the chain gates on
`block.timestamp` — advancing one never moves the other. `common.ts`'s `Given the market has matured` step
advances both: `evm_increaseTime`/`evm_mine` for the chain, then Playwright's `page.clock.setFixedTime` (not
`.install()`/`.tick()`, which would also freeze `setInterval`-based query polling) for the browser, followed by a
reload so components re-render against the new time from their very first paint.

**Step-function fixture-object quirk:** `playwright-bdd`'s `bddgen` inspects each step function's source at
generation time and requires the first parameter to literally be an object-destructuring pattern (`{ page }` or
even empty `{}`), even when a step needs no fixtures at all — an arrow function like `async (_fixtures, arg) => {}`
fails `bddgen` with "First argument must use the object destructuring pattern". Use `{}` (with an
`eslint-disable-next-line no-empty-pattern` comment, since plain `{}` otherwise trips that lint rule) instead of a
named-but-unused parameter.

`bddgen` (run automatically by `test:e2e`/`test:e2e:ui`) generates `.features-gen/` from the `.feature` files;
that directory is gitignored per `playwright-bdd`'s own convention and should never be edited by hand.

## Scenario coverage checklist

Adapted from ponytail-fullstack-web3's `web3-qa` matrix. When adding a journey or reviewing suite coverage,
sweep each dimension — the gaps live in the combinations, not the happy paths:

- **Identity churn** — account switch and chain switch at each operation stage: form open, reviewing,
  approving, signing, queued mid-run (`UI-ACTION-WALLET-CHANGED`; the queue's `account`/`chain` pauses).
- **Approval states** — approval needed, already covered, reverted, and the zero-first double approval
  (`UI-ACTION-APPROVE`).
- **Transaction outcomes** — wallet rejection, on-chain revert, confirmed-but-refresh-failed, and the
  recoverable races (`re-confirm`, `needs-review`): distinct events with distinct renderings
  (`docs/maps/ui/action.md` rule 3).
- **Interruption** — reload mid-flow, closing the overlay after broadcast, resume after a failed or paused
  queue row.
- **Contract clamps** — partial fill against the slippage floor, matured-market refusals, `nothing-left`
  after external claims.
- **Degraded reads** — unavailable registry, truncated discovery, projection unavailable: the five-state
  honesty rules (`CS-S1`…`CS-S12`) verified under E2E conditions, not only in unit tests.
