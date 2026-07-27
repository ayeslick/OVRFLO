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

**Known fixture blocker (confirmed against a real run):** `script/seed-local.sh` hardcodes `PRIMARY_EXPIRY` at
2026-06-25 (see `fixtures/chain.ts`), which as of this writing has already passed. The script has its own explicit
guard for this (`PRIMARY_EXPIRY <= $BLOCK_TIMESTAMP`, checked against the forked block's own timestamp) and exits
before seeding anything:

```
[2/5] seeding OVRFLO (factory + ovrflo + lending + PT/wstETH to dev/lender wallets)
seed-local: fixture markets are expired at fork timestamp 1785184283
seed-local: repin script/lib/OVRFLOTestFixtures.sol fixtures before seeding
```

`SECONDARY_EXPIRY` (2027-12-30) is still comfortably in the future — it's `PRIMARY_EXPIRY` alone tripping the
guard, but the guard checks both together and aborts the whole run either way. This is a seeding-script problem,
not an E2E-suite problem; every scenario in this suite already only exercises `SECONDARY_MARKET` for exactly this
reason, so the suite itself has no dependency on `PRIMARY_EXPIRY` staying valid — but `bootstrap:local` won't get
far enough to start a dev server at all until the seeding script is fixed (e.g. computing both expiries relative
to the fork's own block timestamp at seed time). That fix is separate follow-up work and is the one remaining
blocker to actually running this suite end-to-end; every scenario here has been typechecked, linted, and wired
through `bddgen` (`npx playwright test --list`), but none have been executed against a live fork.

The dev server must run with `NEXT_PUBLIC_E2E=1` so `lib/wagmi.ts` swaps in the mock wagmi connector (KTD6) instead
of initializing Reown AppKit — the real wallet-connect UI has no automatable "approve" step, so E2E always signs as
a pre-connected mock account instead:

```bash
NEXT_PUBLIC_E2E=1 npm --prefix web run dev
```

With the fork running and the dev server pointed at it (with `NEXT_PUBLIC_E2E=1` set), run:

```bash
npm --prefix web run test:e2e       # headless
npm --prefix web run test:e2e:ui    # Playwright UI mode, for local debugging
```

By default Playwright targets `http://localhost:3000`; override with `E2E_BASE_URL` if the dev server runs
elsewhere. This is a Playwright-runner-only variable, not one of the app's `NEXT_PUBLIC_*` runtime knobs, so it
lives here rather than in `web/.env.example`. Similarly, `E2E_RPC_URL` (default `http://127.0.0.1:8545`) points
`fixtures/rpc.ts`/`fixtures/chain.ts` at the Anvil fork directly, for `evm_snapshot`/`evm_revert` and the arrange
helpers that sign as Anvil's own unlocked dev accounts.

**Why not Playwright's `webServer` option to auto-start the dev server:** `bootstrap-local.sh` `exec`s into a
foreground dev server by default (that's what `BOOT_NO_UI=1` above suppresses), so seeding and serving aren't
cleanly separable into a `webServer` command yet. Revisit this once the `PRIMARY_EXPIRY` seeding blocker above is
fixed and the full lifecycle (seed -> serve -> test) has actually been run end-to-end against a real fork.

**Why `workers: 1`:** every scenario mutates the one shared seeded fork's real chain state. `fixtures/fork-snapshot.ts`
is an `auto: true` fixture that wraps every scenario in `evm_snapshot`/`evm_revert`, which is expected to make
scenarios safe to parallelize — but that hasn't been validated against a real fork yet (see the `PRIMARY_EXPIRY`
blocker above), so serial execution stays the default per KTD7 in the plan until it has.

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
