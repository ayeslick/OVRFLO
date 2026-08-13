# Testing catalog — watch-surface Markets (U13)

Flow-level Playwright/Gherkin suite against the shipped watch-surface app.
Workers: 1. Addresses are read lazily from `deployments/local.json` at step
time (`tests/e2e/fixtures/chain.ts`). Do not hardcode market addresses.

Control locators prefer `data-ui="UI-…"`. Optional `@UI-*` tags on scenarios
name the primary control, not a pixel contract.

## Inventory

| Journey | File | What it covers |
|---|---|---|
| Watch | `tests/e2e/watch.feature` | Home wall, role lens, in-place detail, withdraw write, identity churn, reload persistence, hidden zero-count lens, freshness copy |
| Supply | `tests/e2e/supply.feature` | `/supply` SELECT_MARKET → amount → rate → review → approve → confirmed → `/?lens=supplied&position=` plus balance clamp, wallet change, reload, revert-after-drain, registry non-loading |
| Borrow | `tests/e2e/borrow.feature` | `/borrow` stream → amount+rate → review → NFT approve → confirmed → `/?lens=borrowed&loan=` plus no-eligible-stream, empty tick, stale quote, wallet change, reload |
| Repay / close | `tests/e2e/repay-close.feature` | From watch borrowed detail: repay, close-ready, insufficient balance, loan disappeared, mid-flow revert, Back without broadcast |
| Assets | `tests/e2e/deposit-wrap-unwrap.feature` | Three-bay converter wrap/unwrap, empty-reserve clamp, PT deposit → borrow handoff, PT clamp, deposit cap, disconnect, reload |
| First run | `tests/e2e/first-run.feature` | Disconnected entry, protocol-empty guided path (Anvil account #3), skip → chooser, deposit intent → `/assets`, seeded holding wallet never first-run |

## Checklist classes

Each class appears in at least one journey (not every class on every file):

- **Identity churn** — disconnect / reconnect / empty-wallet switch (`watch`, `supply`, `borrow`, `deposit-wrap-unwrap`, `first-run`)
- **Approval states** — approve-if-needed on supply, NFT approve on borrow, PT then fee on deposit, wrap approve
- **Outcomes** — confirmed receipt, mapped revert, stale quote re-review, settled-after-external-repay
- **Interruption** — reload mid-amount, Back on in-place write, URL restore of selected loan
- **Clamps** — insufficient balance / PT, empty tick, empty wrap reserve, deposit cap
- **Degraded reads** — hidden zero-count lens vs visible borrowed, registry non-loading, no-eligible-stream handoff (not confirmed-empty)

## Wallet seam

Watch uses `WalletButton` from `wallet-runtime` (same as supply/borrow/assets/risk).
E2E resolves that specifier to `tests/e2e/support/WalletRuntime.tsx`. No `isE2E`
runtime branch. The mock runtime also exposes `UI-E2E-USE-EMPTY-WALLET` so
first-run can connect Anvil account #3 without touching production UI.

## Not run here

`test:e2e` / `bootstrap:e2e` are owned by the orchestrator (shared fork).
This unit verifies parse via `./node_modules/.bin/bddgen` only (exit 0; 38
scenarios across six feature files).

`npx next build` (not `npm run build`) compiled, then failed prerendering
`/assets` with `NEXT_PUBLIC_CHAIN_ID is required in the production profile`.
Open Graph keeps `export const dynamic = "force-static"`; `metadataBase` stays
in the root layout. Per-route titles live in server `layout.tsx` files next to
the client pages.
