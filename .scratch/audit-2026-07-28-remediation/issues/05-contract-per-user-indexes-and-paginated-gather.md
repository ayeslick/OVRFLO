# 05 — Contract: per-user indexes + bounded paginated gatherLiquidity

**Category:** feature (contract surface, high consequence)

**Covers:** R9, R10, R11 (Tranche 3 — Contract surface). Findings: M-15 (part), contributes to H-4/H-5 disposition (closed with ticket 06).

**What to build:** `OVRFLOLending` gains on-chain per-user indexes so a lender's or borrower's own positions/loans are a direct read with no global scan, and `gatherLiquidity` becomes bounded and cursored so the client can page through market liquidity instead of reading the whole id space every time.

**Root cause this closes:** the client currently discovers liquidity positions and loans by walking ids 1 through 500 — the oldest 500 — on-chain. Past position 501 every new position is invisible forever and the window never advances, so a lender can lose their only in-app route to their own capital (H-5), and the same enumeration costs up to 2,500 reads per hook per market, re-run after every confirmed transaction (H-4), with cost scaling with total protocol history rather than what any user owns.

**Details:**
- Add a per-lender position index: `lenderPositionCount` (count) + `lenderPositionAt` (index mapping) — mapping-as-sequence shape, **not** a storage array (consistent with the standing project preference against arrays where mappings suffice).
- Add the same shape for per-borrower loans.
- Update `gatherLiquidity` to accept a scan bound and return a cursor, so the client can page rather than reading everything in one call.
- Resolve the two open implementation questions the plan deferred, and document the decision in the PR:
  - Whether withdrawal swap-and-pops to keep the per-user index dense, or leaves gaps for the client to filter.
  - Whether the per-user index is backfilled for positions created before it ships, or applies only to new positions with a one-time migration read path.
- This is contract-only — no client wiring in this ticket (that's ticket 06).

**Acceptance criteria:**
- [ ] `lenderPositionCount`/`lenderPositionAt` (or equivalent naming) added and populated on position creation, updated on withdrawal
- [ ] Per-borrower loan index added in the same shape
- [ ] `gatherLiquidity` accepts a bound and returns a cursor for continuation
- [ ] `forge build` then `forge test` green
- [ ] Invariant tests (`OVRFLOLendingInvariant.t.sol`) extended to cover the new index staying consistent with position/loan lifecycle (create, withdraw, adjust)
- [ ] Fork tests green
- [ ] A re-audit note recorded (per the plan's tranche gate) documenting the new index and view surface for the next reviewer

**Out of scope:**
- Client-side consumption of these reads (ticket 06)
- Any change to `_claimFair`, `closeLoan`, or `repayLoan` accounting (H-1 is rejected, not fixed)
- Storage array approach — explicitly rejected in favor of mapping-as-sequence

**Blocked by:** None — can start immediately.

**Status:** wontfix (descoped 2026-07-29)

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 3, gate: `forge build`/`forge test`, invariant + fork tests green, re-audit recorded).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. This is the highest-consequence real finding in the whole audit (H-4/H-5) — prioritize accordingly even though it has no hard technical blocker forcing it first.

**2026-07-29 (descoped):** The user declined the Solidity change outright on 2026-07-29. No contract work ships in this plan.

Consequence, recorded rather than absorbed: **H-4 and H-5 remain open**, and R9–R13 are unmet. A lender's liquidity positions past the client's 500-id oldest-first enumeration window stay unreachable through the app at any protocol size, and every position view keeps paying a read cost that scales with total protocol history rather than with what the user owns. These are the audit's two highest-consequence findings that were not disproven.

The design work is not lost — the unit body in `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` is preserved verbatim under KTD11, including the third index (per-lender loan-pool participation) that doc review identified as necessary for R13 to hold, the append-only-with-gaps density decision and its rationale, and the four ABI callers that break on contact with a changed `gatherLiquidity` signature.
