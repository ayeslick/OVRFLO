# 05 — Summary strip + claim-all queue

**What to build:** A strip above the markets table (visible only when connected with at least one position) aggregating the user's streams, supplied liquidity, loans, and claimable amounts — grouped per token symbol, never summed across different tokens. Its one action, CLAIM ALL, opens a review modal listing every pending claim transaction; the user explicitly confirms before anything is signed. The queue runs one transaction at a time with per-row status, can be resumed after a failure (re-checking what's still actually claimable rather than blindly retrying), and clearly shows a done state at the end.

**Blocked by:** 02 — Borrow router + claim-all planner, 03 — Data-layer fixes: invalidation, confirmation state, real symbols

**Status:** resolved

- [x] Strip renders only when connected and holding at least one position across any market; never renders an empty strip
- [x] Amounts are grouped per token symbol; two markets with different symbols never get summed together
- [x] CLAIM ALL is disabled with a "nothing claimable yet" caption when total claimable is zero, even though positions exist
- [x] The review modal does not start signing anything until the user explicitly confirms the queue
- [x] Queue executes sequentially, waits for each receipt before advancing, and refreshes on-chain data after every confirmed transaction (not just at the end)
- [x] A failure mid-queue stops after the in-flight transaction and offers resume, which re-evaluates what's still claimable from live data rather than resubmitting the stale plan
- [x] If the connected wallet changes mid-queue, the queue pauses and resume re-plans against the new account
- [x] On full success, focus moves to a clear "done" affordance; on unrecoverable failure, focus moves to close
- [x] One market's slow or errored data does not stall or corrupt another market's aggregate display

## Comments

**2026-07-27 (agent):** Resolved (see `git log` for `feat(web): summary strip aggregates and claim-all transaction queue`). New `useTxQueue` (sequential, per-receipt `invalidateAllOnChainReads` + held-streams retry, failure stop, signer-switch pause, live-data resume keeping confirmed rows), `ClaimAllModal` (review-then-confirm, per-row status, Escape/scrim blocked while in flight, DONE/CLOSE focus management, heading focus parking when the confirm button unmounts), and rewritten `PositionSummary` (per-market reporter children via identity-stable `onData` with cleanup; per-symbol grouping; R33 dash-per-symbol degradation; obligation-weighted loan progress). Strip moved above the table per R1. 11 new tests; suite 90/90, tsc/eslint/banned-patterns clean. Review fixes: single-column strip below 800px with full-width CLAIM ALL, caption below button, focus parking. Fork end-to-end claim run deferred to U10 gates.
