# 09 — Ponder demand pipeline (trailing 30-day borrow volume)

**What to build:** Index borrow-pool-creation events (which market, which rate, how much) so the SUPPLY ladder and the empty-BORROW-ladder state can show real recent borrower demand per rate, instead of nothing. Must degrade honestly and visibly when the indexer is unreachable — distinct from "reachable but genuinely zero demand," which is also a valid, honestly-displayed state.

**Blocked by:** 06 — BORROW mode: ladder, quote, router wiring, re-quote recovery, 07 — SUPPLY mode: ladder + tick selection

**Status:** resolved

- [x] New indexed event data is queryable per market, grouped by rate, over a trailing 30-day window, excluding the connected user's own borrowing (self-demand isn't real signal)
- [x] Each rate's demand renders as a qualitative label (relative to this market's own peak volume) plus the raw count and amount, with a visible "trailing 30 days" annotation
- [x] Indexer unreachable → a distinct, clearly labeled "no demand data" state (not zero bars, not blank)
- [x] Indexer reachable but genuinely no borrows in the window → zero bars with an honest "no loans in 30 days" label (visibly different from the unreachable state)
- [x] The rest of the app works fully with the indexer turned off entirely — this column is the only thing that degrades
- [x] One live end-to-end check: perform a real borrow on the local fork, see it appear in the demand column within one refetch

## Comments

**2026-07-27 (agent):** Resolved (see `git log` for `feat(web,ponder): trailing 30-day borrow-demand pipeline`). Ponder side: `borrow_events` table + `OVRFLOLending:BorrowerLoanPoolCreated` handler, sourced through a factory pattern over `OVRFLOFactory.LendingDeployed` (`PONDER_OVRFLO_FACTORY` env, zero-address default indexes nothing). Web side: `lib/demand.ts` (pure window/self-exclusion aggregation + peak-relative `demandLevel`, TDD), `fetchBorrowDemand` (throws on unreachable — deliberately unlike `fetchHeldStreamIds` — so "no data" never collapses into "zero"), `useBorrowDemand` (unavailable/loading/ok status; window anchored to CHAIN time via `useBlock` — the live fork check caught that wall-clock anchoring excludes everything when fork time lags months behind). SUPPLY ladder rows carry `DEMAND <LEVEL> · count · amount` cells + trailing-30-days annotation; empty BORROW ladder lists per-rate recent demand; unreachable renders `DEMAND: NO DATA` / `INDEXER UNREACHABLE`, distinct from `NO LOANS IN 30 DAYS`. Indexer-off leaves the rest of the app untouched (verified: only the demand column imports the hook). Live e2e on the anvil fork: seed → supply 10 wstETH @10% → deposit 5 PT (stream 23048) → borrow 0.466 wstETH → `BorrowerLoanPoolCreated` indexed within one 2s poll → returned by the exact windowed query the column uses. Two-axis review: spec clean; standards judgement fixes applied (`borrowEventKey` helper per handler convention, cutoff re-filter rationale comment). Note for ops: `NEXT_PUBLIC_PONDER_URL` must point at the `/sql` mount (e.g. `http://localhost:42069/sql`). Suite 147/147.
