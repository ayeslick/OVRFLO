# 05 — Playwright E2E / Gherkin journeys

**What to build:** Executable `.feature` scenarios (via `playwright-bdd`) for every key user journey, run against the seeded local Anvil fork (`bootstrap:local`). This is the largest ticket in the effort — most of the actual journey coverage lives here.

**Blocked by:** Ticket 01 (Playwright/playwright-bdd configured).

**Status:** ready-for-human

### Fixtures (wire these first)

- [x] `web/tests/e2e/fixtures/mock-wallet.ts`: wagmi `mock` connector gated behind an E2E-only env var (e.g. `NEXT_PUBLIC_E2E=1`), configured with a well-known zero-value Anvil devnet private key — **never** a key holding real value on any chain. No test-mode connector exists in `web/lib/wagmi.ts` today (Reown AppKit/WalletConnect only), so this is new wiring. Note: this bypasses the real Connect-Wallet/WalletConnect UI; that flow is not exercised by any scenario below.
- [x] `web/tests/e2e/fixtures/fork-snapshot.ts`: Playwright fixture that calls `evm_snapshot` before each scenario and `evm_revert` after, so the shared seeded fork stays safe under Playwright's default parallel workers despite every journey mutating real on-chain state. If this proves awkward to wire correctly, fall back to `workers: 1` for the e2e project rather than shipping with no isolation story.

### Feature files (happy path + per-journey error states, as ordinary scenarios — not a separate "attack tests" category)

- [x] `borrow.feature` — entry: BORROW modal on a lending market card; decision: selecting liquidity rungs + slippage tolerance; exit: new loan in borrower's loan book, wallet balance reflects borrowed amount. Error states: insufficient balance, invalid slippage ("SLIPPAGE MUST BE 0.1-5%"), market matured ("BORROWING CLOSED"), stale-liquidity re-confirm (a revert reason in `STALE_LIQUIDITY_REASONS` from `lib/errors.ts` triggers `classifyBorrowError`'s automatic re-quote — see AE5). Also hosts R12's focus-trap/Escape scenario (per AE2) and the disabled-caption check for "MARKET MATURED — BORROWING CLOSED" / "SLIPPAGE MUST BE 0.1–5%".
- [x] `supply.feature` — entry: SUPPLY modal; decision: approve (if needed) then confirm amount; exit: new liquidity position appears for that market. Error states: insufficient balance, market matured ("SUPPLY CLOSED"). Also hosts the disabled-caption check for "MARKET MATURED — SUPPLY CLOSED" and R13's responsive-viewport check (800px/1200px via `page.setViewportSize()`).
- [x] `claim-all.feature` — entry: CLAIM-ALL action on a position with claimable proceeds; decision: none (single confirm, no amount field); exit: claimable balance drops to zero, wallet balance increases. Error state: contract revert only.
- [x] `adjust-rate.feature` — entry: ADJUST-RATE modal on an open liquidity position; decision: entering a new APR within market bounds; exit: position's listed rate reflects the new value. Error states: market matured ("RATES CLOSED"), contract revert mapped to user-facing copy. Also hosts the disabled-caption check for "MARKET MATURED — RATES CLOSED".
- [x] `deposit-wrap-unwrap.feature` — entry: CONVERT modal; decision: choosing deposit vs. claim-matured vs. wrap vs. unwrap and an amount within the relevant cap/capacity; exit: ovrfloToken/underlying/PT balances shift 1:1 per direction. Error states: insufficient balance, deposit cap reached ("DEPOSIT CAP REACHED"), claim-before-maturity ("CLAIM ENABLES AFTER MATURITY"), unwrap capacity exceeded. Also hosts both disabled-caption checks above.
- [x] `repay-close.feature` — entry: REPAY or CLOSE action on an open loan; decision: repay amount (MAX button uses `repayMax` from `lib/modal-logic.ts`) or a single confirm for close; exit: outstanding debt decreases (repay) or loan disappears from the borrower's loan book (close). Error states: insufficient balance (repay), stale/unknown loan ("LOAN NOT FOUND"), contract revert mapped to user-facing copy.
- [x] R12's remaining cross-cutting scenario — empty position categories (zero open positions of a given type render nothing, not placeholder text) — placed in whichever of the above files most naturally exercises it

### Cross-cutting

- [x] Every acceptance example (AE1-AE5 in the plan) has at least one executable scenario
- [x] `npm --prefix web run test:e2e` passes against a freshly `bootstrap:local`-seeded fork — unblocked (live Pendle market discovery replaced the stale `PRIMARY_EXPIRY` fixture, see `docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md`); full 31-scenario suite passes against a fresh `bootstrap:e2e` run as of 2026-07-28
- [x] CI wiring is explicitly out of scope for this ticket — `test:e2e` is a local developer command for now (see Ticket 01)

**Explicitly deferred (do not add in this ticket):** dedicated journeys for `withdraw`, `claim_share`, `claim_stream` (`SimpleActionForm`'s single-confirm, no-decision-point shape) — the same shape is already proven by `claim-all.feature` and Ticket 04's component test. Add a dedicated journey if one of these three grows real branching logic.

See plan Unit U5 (R10, R11, R12), KTD6, KTD7 in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

**2026-07-27 — implementation complete, one blocker outside this ticket's scope:**

All fixtures and all six feature files exist, are wired through `bddgen` (31 scenarios total, `npx playwright
test --list` confirms every step resolves), typecheck clean, lint clean, and don't regress the existing 306-test
Vitest suite. Every AE1-AE5 acceptance example and every named error state in this ticket has a scenario,
including "DEPOSIT CAP REACHED" (arranged via a real `setMarketDepositLimit` call through the factory, using
Anvil's default account #0 as the local "multisig" — same admin path production uses: multisig -> factory ->
vault).

**What's NOT done and can't be from this seat:** no scenario has been executed against a live fork.
`BOOT_NO_UI=1 npm --prefix web run bootstrap:local` was run for real (with `MAINNET_RPC_URL` from `.env`) and
fails immediately at the seeding step:

```
seed-local: fixture markets are expired at fork timestamp 1785184283
seed-local: repin script/lib/OVRFLOTestFixtures.sol fixtures before seeding
```

`PRIMARY_EXPIRY` in `script/seed-local.sh` (2026-06-25) is already in the past relative to real wall-clock time;
the script's own guard catches this before ever reaching `OVRFLOFactory.addMarket` or seeding any balances. This
is a pre-existing fixture-staleness problem in the seeding script, unrelated to anything built in this ticket —
every scenario here already only targets `SECONDARY_MARKET` (expiry 2027-12-30) for exactly this reason, so the
E2E suite itself has no dependency on `PRIMARY_EXPIRY`. But `bootstrap:local` won't get far enough to start a dev
server at all until that script is fixed (e.g. computing expiries relative to the fork's own block timestamp at
seed time, or repinning to a further-future real Pendle market). See `tests/e2e/README.md` for the full writeup.

Recommend: a human either (a) fixes the seeding script's expiry handling and re-runs this suite for real, or (b)
accepts the current state (fully written, wired, and statically verified; unexecuted pending that unrelated fix)
and tracks the seeding-script fix as its own follow-up ticket. Left as `ready-for-human` rather than closing, since
"passes against a freshly bootstrapped fork" is an explicit acceptance criterion that genuinely isn't met yet.

Also fixed two small pre-existing bugs discovered while verifying this ticket: `.gitignore` pointed at
`web/tests/e2e/.features-gen/` but `defineBddConfig`'s default output actually lands at `web/.features-gen/`
(so the generated directory was never actually gitignored), and `eslint.config.mjs` had no `ignores` entry for it
either, so `npm run lint` would fail on generated code the moment anyone ran `test:e2e` locally. Both fixed.
