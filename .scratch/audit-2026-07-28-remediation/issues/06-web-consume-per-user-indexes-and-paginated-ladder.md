# 06 — Web: consume per-user indexes + paginated borrow ladder

**Category:** feature (closes H-4/H-5)

**Covers:** R12, R13 (Tranche 3 — Contract surface). Findings: H-4, H-5 (both closed by this ticket, on top of 05).

**What to build:** The client stops walking the global id space to find a user's own positions/loans or to compute borrow ladder depth. It reads the new per-user indexes and bounded `gatherLiquidity` from ticket 05 instead — closing the bug where a lender's position past id 500 becomes permanently invisible, and the bug where every hook re-scans the full protocol history on every confirmed transaction.

**Details:**
- Swap the client's own-positions and own-loans discovery from a global id scan to the new `lenderPositionCount`/`lenderPositionAt` (and borrower equivalent) reads.
- Borrow ladder tick depth is derived from the bounded, cursored `gatherLiquidity` read, paging as needed rather than reading the whole market in one shot.
- The borrow flow consumes the sufficiency signal that bounded read returns (i.e. it knows whether it has walked enough of the ladder to trust the depth shown, not just the first page).

**Acceptance criteria:**
- [ ] AE4: a lending market with more than 500 liquidity positions — a lender who supplies into it sees their own position in their positions view with WITHDRAW and ADJUST RATE available, and the read cost does not grow with the market's total position count
- [ ] AE5: a tick funded only by positions created after the 500th shows its true depth in the borrow form and is selectable
- [ ] R13: no liquidity position or loan is unreachable/invisible to its owner at any protocol size, and no position view's cost scales with total protocol history
- [ ] Web coverage of the per-user read path and the paginated gather (per the plan's tranche gate)
- [ ] `npm --prefix web run test` green

**Out of scope:**
- Any further contract changes (that's ticket 05)
- Ladder price curation / early-termination signaling for a truncated page walk — flagged as an open question in the plan, not required here unless it blocks correctness

**Blocked by:** 05 (needs the on-chain per-user indexes and bounded `gatherLiquidity` to exist before the client can consume them).

**Status:** wontfix (descoped 2026-07-29)

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 3).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Ticket 15 (degraded-indexer UX) also depends on this landing, since R45 ("positions/loans/ladder depth remain fully available while indexer unreachable") only holds once ladder depth comes from the protocol instead of the indexer.

**2026-07-29 (descoped):** Blocked by ticket 05's descope — this ticket's entire premise is consuming contract reads that will not exist.

Consequence, recorded rather than absorbed: **H-4 and H-5 remain open**, and R9–R13 are unmet. A lender's liquidity positions past the client's 500-id oldest-first enumeration window stay unreachable through the app at any protocol size, and every position view keeps paying a read cost that scales with total protocol history rather than with what the user owns. These are the audit's two highest-consequence findings that were not disproven.

The design work is not lost — the unit body in `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` is preserved verbatim under KTD11, including the third index (per-lender loan-pool participation) that doc review identified as necessary for R13 to hold, the append-only-with-gaps density decision and its rationale, and the four ABI callers that break on contact with a changed `gatherLiquidity` signature.
