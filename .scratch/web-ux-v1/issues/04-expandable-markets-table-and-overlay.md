# 04 — Expandable markets table + slim action overlay

**What to build:** The markets table becomes the primary surface. Clicking anywhere on a market's row expands it in place to show that market's balances, the user's positions in it, and the three action buttons (SUPPLY / BORROW / DEPOSIT PT) — replacing today's flow where you have to open a full-screen overlay just to see your positions. The overlay itself narrows down to a pure action container (it stops also showing balances/positions, since those now live inline). New table columns: maturity date + days-remaining, vault TVL, and a combined rate range column. Disabled actions always show a reason (e.g. "MARKET MATURED", "CONNECT WALLET") rather than disappearing.

**Blocked by:** 01 — Display math for outcome-first pricing, 02 — Borrow router + claim-all planner, 03 — Data-layer fixes: invalidation, confirmation state, real symbols

**Status:** resolved

- [x] Clicking a row (or activating its first-cell button via keyboard) expands it; expanding a second row collapses the first; exactly one row expanded at a time
- [x] Expanded content, in order: balances with context-appropriate verbs, this market's positions, then the three mode buttons
- [x] Wrap functionality moves behind a collapsed "ADVANCED" disclosure in the balances block — it's no longer a first-class action
- [x] Disconnected wallet: no balances shown, all mode buttons disabled with "CONNECT WALLET"
- [x] Matured market: DEPOSIT hidden, SUPPLY/BORROW disabled with "MARKET MATURED", the ovrfloToken verb becomes CLAIM PT instead of UNWRAP
- [x] Market with no lending deployed: SUPPLY/BORROW disabled with "LENDING NOT DEPLOYED"
- [x] Keyboard: the row itself is not a tab stop; a real `<button>` in the first cell is the focus target and responds to Enter/Space
- [x] Rate column shows "—" when a market has no liquidity at any tick yet
- [x] Overlay retains its existing focus trap, Escape handling, and open/close animation unchanged

## Comments

**2026-07-27 (agent):** Resolved in commit bef631f. New `MarketRowDetail` + rewritten `MarketsTable` (ASSET/MATURITY+Nd/TVL/RATES columns, one-at-a-time accordion, first-cell button focus target, row not a tab stop, `aria-expanded` on both row and button, `role=region` detail). `MarketDetail` is now a pure action container taking an `action` prop; KTD1 two-level state (`selectedMarket` + `activeMode`) in `MarketsApp`, both cleared on signer switch. WRAP behind ADVANCED disclosure. RATES uses `buildLadder` + `upfrontBps` (upfront-at-max-tick paired first since upfront falls as APR rises), "—" when dry. Review fixes applied: R8 PT balance-row DEPOSIT PT verb restored, DESIGN §8 NO BALANCE captions on zero-balance disables. 8 new tests; suite 79/79, tsc/eslint/banned-patterns clean. Fork visual pass deferred to U10's gate sweep.
