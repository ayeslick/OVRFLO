# 08 — Position cards, sell removal, adjust-rate

**What to build:** Streams, loans, and supplied-liquidity positions become card-style displays with progress bars (instead of today's plain rows), each showing the right information and the right available actions for its actual state. The SELL action is fully removed from the UI (locked product decision — this protocol doesn't support a resale market in v1). Lenders gain an "adjust rate" action that moves their idle liquidity to a different rate in a single transaction.

**Blocked by:** 01 — Display math for outcome-first pricing, 03 — Data-layer fixes: invalidation, confirmation state, real symbols, 04 — Expandable markets table + slim action overlay

**Status:** resolved

- [x] Stream cards show a progress bar of how much has streamed, the currently claimable amount, and (when real liquidity exists) a live "you could borrow ~X% upfront" teaser linking into BORROW mode
- [x] Loan cards correctly distinguish three states: actively self-repaying (no primary action — repay is available only behind an "advanced" disclosure), obligation met but not yet closed (a distinct "residual returning" state, not lumped in with settled), and fully settled (dimmed, badged)
- [x] A loan only shows a CLOSE action when it can actually succeed (depends on the read added in Ticket 03) — never offers a button that's guaranteed to revert
- [x] Supplied-liquidity cards show idle amount, the rate they're earning, and the new adjust-rate action
- [x] Adjust-rate re-reads the position's current idle amount immediately before submitting (not a stale cached value) — if it's shrunk since the form opened, the fresh value is used, never the stale one
- [x] Adjust-rate failure (or a detected stale-vs-fresh mismatch) triggers the same re-quote/re-confirm recovery pattern as Ticket 06, not a generic error
- [x] After confirmation, the actual moved amount is parsed from the receipt and shown if it differs from what was requested
- [x] SELL is not reachable anywhere in the UI — no button, no route, no leftover copy referencing it
- [x] Existing full-suite tests (including the app's negative "SELL should not appear" assertions) stay green with the extended checks

## Comments

**2026-07-27 (agent):** Resolved (see `git log` for `feat(web): position cards with progress bars, adjust-rate, SELL removal`). New `web/lib/positions.ts` (loanCardState three-state split, streamedPct/obligationPct clamped progress, borrowTeaserBps at best liquid tick, adjustReceiptSummary pairing withdraw-refund with supplied amount, classifyAdjustError extending the ticket-06 stale set with ERC20 shortfalls). PositionList rebuilt as cards (stream/loan/liquidity/pool) with side-colored progress bars; DESIGN.md amended with the position-cards exception (§5/§12). AdjustRateForm: RateLadder pick, allowance approve, fresh `liquidityPositions` re-read at submit (mismatch → re-confirm banner, never a stale submit), multicall(withdraw+supply), receipt-surfaced wallet top-up when the position shrank mid-flight (review catch: supplyLiquidity always supplies its argument, so the withdraw leg is the honest comparison). SELL removed type-first (ActionType, SellForm, chooseSellNowLiquidity, SaleListing, error copy) with a negative render assertion. CLOSE stays hidden (not disabled) when it would revert — ticket-mandated, R17 test-enshrined, noted as a DESIGN.md §8 exception. Modal error boundary (critical pattern #3) confirmed missing repo-wide — spun off as a follow-up task rather than scope-creeping here. Suite 135/135; tsc/eslint/banned-patterns clean.
