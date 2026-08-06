# 11 — Re-wire BorrowForm to the pure client-side router

**What to build:** Fix a regression found in code review: the plan's central architectural decision — "the router is pure client-side; `gatherLiquidity` is demoted to a test oracle... NOT called in the borrow path" — was correctly built in ticket 02 (`planBorrow` in `web/lib/router.ts`, full branch-coverage tests), but commit `88ffcdf` ("remove borrow helpers superseded by the ticket-06 rewrite") deleted its wiring into the form. `BorrowForm` in `web/components/ActionModal.tsx` currently calls a live on-chain `gatherLiquidity` read (`ActionModal.tsx:910-919`) and submits its `gatherIds` straight to `createBorrowerLoanPool` (`ActionModal.tsx:1182`) — `planBorrow` isn't imported or called anywhere in the form. This silently reintroduces plain oldest-id-first accumulation via the contract view instead of the router's single-coverage-first preference, and reopens the enumeration-cap dependency (ids beyond the ~500 scan window) the plan explicitly designed the router to close.

Re-wire `BorrowForm` to build its submitted liquidity ids from `buildLadder` (already imported and used for the ladder display) + `planBorrow`, matching how ticket 02 and the plan's KTD3 specify — including the price-cap clamping and the primary/alternative tick UI already built in ticket 06. Remove the `gatherLiquidity` on-chain read entirely from the borrow submission path (it may still be referenced as a test oracle per the plan, but must not drive the actual transaction).

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

- [ ] `BorrowForm` imports and calls `planBorrow` (from `web/lib/router.ts`) to determine submitted liquidity ids — not a live `gatherLiquidity` read
- [ ] The `gatherLiquidity` on-chain read is removed from the borrow submission path in `ActionModal.tsx`
- [ ] Single-position-covers-fully still wins over accumulating multiple positions (the behavior `planBorrow`'s tests already assert) — verified end-to-end through the form, not just at the unit level
- [ ] The existing price-cap clamp and primary/alternative-tick "show other options" UI (ticket 06) continue to work unchanged with the router-sourced ids
- [ ] `tooLarge`/truncation warning still surfaces correctly since the router (not `gatherLiquidity`) is now the source of ids
- [ ] Full existing test suite green; add a regression test asserting `planBorrow`'s output ids (not `gatherLiquidity`'s) are what gets submitted to `createBorrowerLoanPool`

## Comments

**2026-07-27 — re-triaged, held for human decision, not implemented.**

Investigated before implementing per the docs/solutions house rule. Found the ticket's premise conflicts with a later, deliberate, documented design decision, and implementing it as written would be a regression:

- `planBorrow` no longer exists anywhere in the codebase. Commit `88ffcdf` ("remove borrow helpers superseded by the ticket-06 rewrite") didn't accidentally drop wiring — it deleted the function itself because ticket 06 replaced it with `planSelectedBorrow` (`web/lib/borrow.ts`), a materially different selection-scoped design (fill amount + partial flag + one alternative tick, price-cap clamped). This is corroborated by `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md` (written the same day), which states explicitly: "Position ids for the transaction come from the contract's own `gatherLiquidity` read, not from indexed data."
- The ticket's core justification — that using `gatherLiquidity` "reopens the enumeration-cap dependency (ids beyond the ~500 scan window)" — is backwards. Checked both sides directly:
  - `src/OVRFLOLending.sol:698` `gatherLiquidity` is a live on-chain **view** that loops from `startId` to `nextLiquidityId` with no artificial cap — it sees the complete, current on-chain state at submission time.
  - The actual ~500-id cap (`MAX_ENUMERATION_IDS`, `tooLarge` in `web/hooks/useLendingLiquidity.ts`) lives in the **client-side** enumeration used only to build the ladder/display (`buildLadder`), which is what a client-side "pure router" would necessarily plan against.
  - So re-wiring submission to a client-side router would make ids subject to the 500-id scan cap and to staleness between load and submit — exactly the failure class the stale-recovery/re-quote flow (R14, `classifyBorrowError`, `adjust-rate-multicall-shrink-race.md`) was built to guard against. Sourcing ids from `gatherLiquidity` at submit time is strictly safer.
- Net: the current `ActionModal.tsx` implementation (ladder/quote preview via `buildLadder` + `planSelectedBorrow`, actual submitted ids via a fresh `gatherLiquidity` read) appears to be the intended post-ticket-06 architecture, not a regression from it.

Not implementing as written — would revert tested, documented behavior. Re-triaged to `ready-for-human` rather than `wontfix` since a human should decide: close this ticket outright, or the plan's KTD3 text (`docs/plans/2026-07-25-001-feat-web-ux-v1-implementation-plan.md`) needs an explicit superseded-by annotation so future agents don't re-open the same question.
