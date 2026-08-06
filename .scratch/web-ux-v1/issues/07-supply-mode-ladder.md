# 07 — SUPPLY mode: ladder + tick selection

**What to build:** The lender's side of the same tick ladder introduced in Ticket 06 — showing, per rate, the fixed return the lender would earn and how much liquidity is already waiting there — replacing today's hardcoded single rate with real tick selection.

**Blocked by:** 01 — Display math for outcome-first pricing, 02 — Borrow router + claim-all planner, 03 — Data-layer fixes: invalidation, confirmation state, real symbols, 04 — Expandable markets table + slim action overlay, 06 — BORROW mode: ladder, quote, router wiring, re-quote recovery (shares the ladder component built in 06)

**Status:** resolved

- [x] Every available rate renders as a ladder row with its fixed-return percentage and total waiting liquidity (including the lender's own)
- [x] Selecting a rate feeds the actual supply transaction (no more hardcoded rate)
- [x] Works correctly even when the market currently has only one available rate (single-row ladder, not a special case or crash)
- [x] A market past maturity disables supply with a clear reason, checked both when the button is first shown and again if maturity is crossed while the panel is already open
- [x] The demand information for this rate (real data arrives in Ticket 09) shows a clear "no data yet" placeholder in the meantime — never blank or broken

## Comments

**2026-07-27 (agent):** Resolved (see `git log` for `feat(web): supply mode ladder with tick selection and live maturity gate`). Extracted the ticket-06 ladder into a shared `web/components/RateLadder.tsx` (rows carry pre-formatted cells; borrow side unchanged, 11/11 borrow tests green after extraction). `SupplyForm` rebuilt on it: every in-bounds tick (`aprChoices`) is a selectable row with `RETURN` (`lenderReturnBps`) and `WAITING` (buildLadder with no `self`, so totals include the lender's own supply); selection feeds `supplyLiquidity(market, aprBps, amount)`, replacing the hardcoded `aprMinBps || 1000`. Maturity checked at open and re-checked on a 30s clock while the panel is open (`MARKET MATURED — SUPPLY CLOSED`, disabled-with-reason per DESIGN.md §8; fake-timer test covers the crossing). Single-rate market renders a one-row ladder (tested). `DEMAND (30D) AT <rate> — NO DATA YET` placeholder pending ticket 09. Two-axis review applied: ladder empty state dimmed (not status-negative), rates-loaded judged by `aprMaxBps > 0` since `aprMinBps` may legally be 0, dead `+ tick.own` term removed, truncation copy made side-neutral. Suite 115/115; tsc/eslint/banned-patterns clean.
