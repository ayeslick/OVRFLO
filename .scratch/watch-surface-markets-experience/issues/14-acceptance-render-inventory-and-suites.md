# 14 — Acceptance: render inventory + suites

**What to build:** Every deterministic render in the inventory provably renders from pinned fixtures against its brief contract. The whole test surface is green. The accountability ledger is complete. Walk the Experience Review Gate and list gaps for ticket 15 — do not spawn Impeccable, rewrite DESIGN.md, or run ethskills:qa here.

**Blocked by:** 12 — States, navigation, persistence hardening; 13 — Repo sync: concepts, Gherkin, metadata

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U14 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/14-acceptance-render-inventory-and-suites.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not start tickets 15–17 (Impeccable finish, DESIGN.md, ethskills:qa) — those wait on this ticket in a fresh chat.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Acceptance Examples, Verification Contract, Definition of Done, ### U14.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Acceptance Examples, Verification Contract (all gates), Definition of Done, ### U14, Experience Review Gate (record gaps for ticket 15; do not spawn Impeccable)
- Region briefs from ticket 02
- `web/reviews/test-accountability.md` and the deletion list from U1–U13
- `docs/agents/testing.md`
- this ticket's acceptance criteria

- [x] Inventory harness mounts every flow-spec render plus plan additions (three lens renders, ribbon state set, degraded status, first-run, risk, acknowledgment step, both claim-confirmed variants, narrow-viewport watch navigation)
- [x] Each item asserts the owning brief's labels, states, and action-visibility conditions at 1280px and 360px for every transacting topology
- [ ] Full Verification Contract passes: build, unit/component, types, E2E, maps presence, purge greps, query discipline, unit-safety operators, supply-chain, see-equals-sign — **orchestrator.** U14 worker ran inventory vitest + `tsc --noEmit` only. Did not run `npm --prefix web run build`, `bootstrap:e2e`, `test:e2e`, Anvil, or Playwright.
- [x] Accountability ledger has an entry for every removed or weakened test from U1–U13 (U1 purge + U13 Gherkin + reorg-freshness successor). **Review: pending** until the tail (U15–U17) — not an approval.
- [x] Product truth intact: no invented numbers, no engagement mechanics, no health-factor language, projection never gates, failed reads never render as zero (gated in `web/tests/inventory/product-truth.test.ts`)
- [x] Inventory checklist is ready to paste into the PR description (`web/tests/inventory/PR-CHECKLIST.md`)
- [x] Experience Review Gate is walked and gaps listed for ticket 15 — not silently skipped and not executed as this ticket

## Plan unit

U14 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`

## Harness

Fixture-driven tests under `web/tests/inventory/`. Cite table: `web/tests/inventory/CHECKLIST.md`. Paste-ready PR list: `web/tests/inventory/PR-CHECKLIST.md`.

Transacting topologies (borrow, supply, assets/writes, surface states) run at **1280px and 360px**. WatchApp mocks follow `web/tests/watch/watch-app.test.tsx` (`wallet-runtime` required).

Revert-freshness successor: `web/tests/inventory/revert-freshness.test.tsx` (mocked revert+refetch + QueryClient; not live `evm_revert`).

## Worker verification

```
cd web && node ./node_modules/vitest/dist/cli.js run tests/inventory
# 9 files, 70 tests, pass

cd web && npx tsc --noEmit
# pass
```

## Deviations (inventory composition, not plan edits)

- **Claim-confirmed (items 19–20 / G).** Brief `UI-REVIEW-CLAIM-CONFIRMED` wants three next choices on the claim receipt. Shipped `WatchWrite` confirmed claim is PAYOUT + DONE. Inventory asserts unwrap-enabled vs reserve-insufficient by composing `WatchWrite` + `Converter` (assets route), not as one screen.
- **Repay prepare / approve (item 24).** Brief `UI-REVIEW-REPAY-PREPARE` wants `WRAP SHORTFALL` and `APPROVE <ovrflo token>` in the repay write. Shipped `WatchWrite` repay is AmountField + REPAY + ACTION RECEIPT. Inventory composes `Converter` wrap + kit `Receipt`/`ActionButton` for those sub-steps.

## Experience Review Gate (for ticket 15)

Walked against shipped UI. Did not spawn Impeccable. Ten plan points:

1. **Dominant decision in five seconds with gold only on it — gap.** Supplied detail paints earnings gold (`RollingNumber` `accent="gold"`) but `.kit-rolling` has no display-scale font-size, so that gold sits on paper at inherited body size. Borrow `YOU RECEIVE` is gold at 36px (display scale). Dual-role home `resolveLens` prefers **supplied** when that tab is visible, so a wallet with loans does not show a done-date without switching lens. Wall rows are ink, not gold, until selected (selected row is gold-ink **on ink**).

2. **First-time visitor reaches a first action from the guided path — pass (connected empty).** First-run renders only on confirmed-empty books; cycle starts at GET PT; `I ALREADY HOLD PT` → `/assets`; no demonstration loan. Disconnected home is connect + BORROW/SUPPLY/ASSETS links, not the guided cycle.

3. **Every loan answers “when is this over?” with a date — gap until stream truth hydrates.** `BorrowedDetail` shows `DONE DATE` only when `loanCoverAt` has a schedule from `useLoanStreams`. Inventory can pin that map and see the date; a pending/empty map omits it. Borrowed **rows** likewise need `loanStreams` for the state-line date. Dual-role default (point 1) hides the borrowed lens on home.

4. **Receipts before every signature — partial.** Supply/borrow `ReviewHandoff` show PERMISSION + ACTION receipts. `WatchWrite` shows ACTION RECEIPT before claim/withdraw/repay/close. **Gaps:** confirmed claim has no unwrap/keep/CLAIM PT trio (see Deviations); repay has no permission receipt / wrap-shortfall step in place; AE6 cover-date pair exists on **borrow** review (`CURRENT COVER` / `AFTER FULL REPAY`), not on in-place `WatchWrite` repay.

5. **Freshness never overstated — partial.** `StatusLine` names `EVENTS AS OF`, `DEGRADED — SHOWING LAST KNOWN`, `EVENTS UNAVAILABLE`. Signing disables on stale (`STALE — SIGNING DISABLED`). **Gap:** when USD is available, the second span is always `SCHEDULES TICK LIVE` even if event status is degraded/unavailable (USD-unavailable replaces that span — the inventory degraded fixture shows `USD UNAVAILABLE`).

6. **Keyboard-only completion of supply/borrow/repay/claim/wrap — not proven.** `AmountField` submits on Enter; rate paddles are buttons; lens tabs have APG keys (kit unit tests). U14 did not run Playwright. Ticket 15 must walk the five writes keyboard-only.

7. **360px preserves hierarchy and labels — partial.** Narrow watch uses `aria-label="Back to {lens}"` (list→detail return). Transacting topologies mount at 360px in inventory (labels/actions). Visual hierarchy, gold scale, and wrapping at 360px are U15 (Impeccable + screenshots).

8. **Gold text never on paper below display scale — fail as written.** `.kit-rolling[data-accent="gold"]` is `color: var(--gold)` with no display-scale type. `.status-warning { color: var(--gold) }` in `web/app/globals.css` is gold-on-paper at body size (`TruncationNotice` is currently unused, but the rule ships). Queue-band gold is fill (`color` on a band part), not body copy. Primary actions are gold-ink **on ink**. Selected rate chip gold is on the selected (ink) surface.

9. **USD switch never changes what would be signed — pass from code reading.** `TokenUsdSwitch` is display-only. `WatchWrite` / `lib/actions` do not take `usdMode`. Receipts stay token-exact. See-equals-sign byte-equality of PERMISSION RECEIPT to calldata remains an orchestrator Verification Contract gate (U6 tests), not re-run here.

10. **Zero invented numbers — pass on the surfaces inventory mounted.** Disconnected entry has no TVL. Failed asset reads show `CHECKING…`, not `0.00000`. First-run denies health factors rather than showing a gauge. **Gap:** confirmed-claim `PAYOUT` uses the pre-tx `claimable` fixture, not decoded receipt logs (brief: actuals from logs).

### U15 starting list (copy)

- Ship `UI-REVIEW-CLAIM-CONFIRMED` on the claim receipt: `UNWRAP TO UNDERLYING` (enabled vs reserve-insufficient), keep ovrflo token, `CLAIM PT` after maturity — three non-equivalent exits.
- Ship `UI-REVIEW-REPAY-PREPARE` (`WRAP SHORTFALL`) and `APPROVE <ovrflo token>` inside repay; show current vs post-repay cover dates before the repay signature (AE6).
- Size gold heroes to display scale; remove or restyle gold-on-paper below that (`.kit-rolling[data-accent="gold"]`, `.status-warning`).
- Dual-role home: a borrower should answer “when is this over?” in five seconds without a click, or the success criterion needs an Owner-visible exception.
- Do not show `SCHEDULES TICK LIVE` beside degraded/unavailable event status.
- Keyboard-only walk of supply / borrow / repay / claim / wrap; 360px hierarchy pass against the walkthrough.
- Claim-confirmed payout from logs, not the pre-tx fixture.

## Comments

Orchestrator: run the remaining Verification Contract gates (`npm --prefix web run build`, seeded-fork E2E `workers: 1`, maps presence, purge greps, query discipline, unit-safety operators, supply-chain, see-equals-sign). Paste `web/tests/inventory/PR-CHECKLIST.md` into the PR. Do not start tickets 15–17 from this worker.
