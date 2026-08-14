# 15 — Impeccable finish verdict

Reviewed against `.impeccable/mocks/ovrflo-walkthrough-v3-approved.html` (paper, ink, one gold, Schibsted + Martian, role-lens wall + detail) and the U14 Experience Review Gate list. Mode: polish. Grammar: one-bit gold instrument workbench. `DESIGN.md` was not rewritten (ticket 16 already ran). Solidity was not changed.

Method: walkthrough HTML + shipped CSS/kit/flows at **1280px and 360px** (inventory `TRANSACTING_WIDTHS` plus watch narrow-nav). No live browser screenshot pass. Keyboard: inventory/unit (Enter on amount fields; native enabled sign buttons). Playwright E2E was not started.

## Experience Review Gate

| # | Point | Score | Evidence |
|---|---|---|---|
| 1 | Dominant decision in five seconds with gold only on it | **pass** (dual-role default: Owner exception) | Watch earnings / outstanding heroes are display-scale gold (`web/components/kit/hero-rolling.css`, 36px, same as Borrow YOU RECEIVE). Primary actions remain gold-ink on ink. Queue-band gold is fill. Dual-role home still opens **supplied** when that tab is visible (`resolveLens` in `WatchApp.tsx`) — plan Key Decision: lenders visit most. A borrower with a supplied tab does not see a done-date until they switch lens. |
| 2 | First-time visitor reaches a first action from the guided path | **pass** | Unchanged from U14: first-run only on confirmed-empty books; GET PT / I ALREADY HOLD PT; no demonstration loan. |
| 3 | Every loan answers “when is this over?” with a date | **pass** | `BorrowedDetail` always shows DONE DATE. Hydrated schedule → cover date. Missing schedule → `CHECKING…` (not omitted, not invented). Uncovered → `UNCOVERED`. Wall rows: `CHECKING… · STREAM REPAYING` until `loanStreams` hydrates. |
| 4 | Receipts before every signature | **pass** | Claim/withdraw/repay/close still show ACTION RECEIPT before sign. Repay now shows PERMISSION RECEIPT + `APPROVE <symbol>` when allowance is short, and `WRAP SHORTFALL` (`UI-REVIEW-REPAY-PREPARE`) when ovrflo < repay and underlying covers the gap. CURRENT COVER / AFTER THIS REPAY render before the repay signature when schedule is known (AE6). Confirmed claim ships `UI-REVIEW-CLAIM-CONFIRMED`: unwrap / keep / CLAIM PT as non-equivalent exits. |
| 5 | Freshness never overstated | **pass** | `StatusLine` shows `SCHEDULES TICK LIVE` only when status is `synced` or `reconnecting`. Degraded / unavailable omit it. `USD UNAVAILABLE` still replaces that span. Signing still disables on stale. |
| 6 | Keyboard-only completion of supply / borrow / repay / claim / wrap | **pass** (unit; Playwright deferred) | Amount fields submit on Enter. Repay Enter calls `writeContract`. Supply/borrow sign buttons are native `<button>`, enabled, not `tabIndex=-1`, including at 360px (`tests/inventory/keyboard.test.tsx`, `writes.test.tsx`). Playwright walk not run (no seeded-fork E2E this ticket). |
| 7 | 360px preserves hierarchy and labels | **pass** | Inventory transacting topologies still mount at 360px. Narrow watch keeps `Back to {lens}`. Gold heroes are 36px display. Claim/repay prepare labels hold in the 360px inventory mounts. |
| 8 | Gold text never on paper below display scale | **pass** | `.kit-hero .kit-rolling` is 36px. `.status-warning` is `--ink` via `web/app/status-warning.css` (loaded after `globals.css`). Queue-band gold remains fill. |
| 9 | USD switch never changes what would be signed | **pass** | Unchanged from U14: display-only; writes do not take `usdMode`. |
| 10 | Zero invented numbers | **pass** | Confirmed-claim RECEIVED comes from lending `Claimed` logs (`claimedPayoutFromLogs`), not pre-tx `claimable`. Failed/missing logs render `CHECKING…`. Failed asset reads still `CHECKING…`. No health-factor / TVL invention. |

## What matches the walkthrough

Paper canvas, ink rails, square controls, Martian receipts, Schibsted decisions, one gold accent. Home is the watch wall with SUPPLIED / BORROWED / STREAMS. Status line uses `EVENTS AS OF` and `SCHEDULES TICK LIVE` when live. Supplied detail leads with YOUR EARNINGS. Borrowed detail leads with outstanding and a done-date. Primary actions invert to ink with gold outline.

## What this ticket fixed

- Claim confirmed: three non-equivalent exits on the receipt; RECEIVED from `Claimed` logs.
- Repay: wrap-shortfall handoff (`/assets/?return=repay&loan=`), exact-amount approve, cover-date pair before sign.
- Gold heroes at display scale; warning copy ink.
- DONE DATE / borrowed row `CHECKING…` while schedule hydrates.
- Status line no longer claims live schedules beside degraded/unavailable events.
- Forced-colors: selected row/rate get a `CanvasText` outline; minibands keep `forced-color-adjust: none`.

## Owner-visible exceptions

1. **Dual-role default stays supplied.** Plan Key Decision (home architecture): dual-role wallets default to the supplied lens because lenders visit most. Not changed. A borrower who also supplies must switch lens to see a done-date in five seconds.
2. **`DESIGN.md` predates these CSS fixes.** Ticket 16 generated `DESIGN.md` before U15. It still names gold-on-paper `.kit-rolling` / `.status-warning` as shipped exceptions. The overrides now live in `hero-rolling.css` and `status-warning.css`. Do not treat that DESIGN.md paragraph as current without a later document pass.
3. **Keyboard Playwright / seeded-fork E2E not run.** Unit inventory only. Production `next build`, DNS/IPFS, WalletConnect deep-link remain owner-blocked (U17).
4. **Live screenshot pass vs the walkthrough HTML was not taken.** Comparison is source + inventory at both widths.
5. **Incumbent kit/watch/globals font-size literals** (10–13px labels, 18px entry prose) stay. They are the committed world; this ticket did not restyle them. The design-hook scan of those files is not a U15 defect list.

## Product truth

No new accent, no attention strip, no health-factor framing, no invented numbers. Wrap-shortfall amount uses throw-tolerant storage (`# ponytail:` in `writeRepayHandoff`); if `setItem` fails the user re-enters the amount.
