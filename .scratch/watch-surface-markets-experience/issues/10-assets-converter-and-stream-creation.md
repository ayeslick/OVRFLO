# 10 — Assets: converter + stream creation

**What to build:** The 1:1 wrap/unwrap converter in the approved three-bay geometry, and the PT-deposit stream-creation flow with its two approvals, handing off to borrow against the new stream.

**Blocked by:** 04 — Component kit; 06 — Hooks + executor re-anchor

**Status:** resolved (component). E2E wrap + deposit-create-stream remains for the fork suite (out of this session).

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U10 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/10-assets-converter-and-stream-creation.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not invent a third-bay pattern on Borrow/Supply. Follow the assets brief and flow-spec ASSETS/STREAM tables.
Before any writes, read Required reading below and the plan sections: Goal Capsule, R12–R13, KTD5, ### U10.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R12–R13, ### U10
- Assets and review briefs from ticket 02
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` ASSETS/STREAM tables (read-only)
- Approved three-bay converter mock (D3 corrections)
- `docs/agents/testing.md` before E2E
- this ticket's acceptance criteria

- [x] Converter keeps three-bay geometry: reserve bay, wrap/unwrap center with deterministic OUTPUT, ovrflo-token bay with contract-literal claim-on-PT language
- [x] Wrap 1:1 with exact allowance; unwrap with no approval
- [x] Reserve-insufficient unwrap is an unavailable route (shows available reserve), never a failure
- [x] Stream creation: market → PT amount → review (PT in, minted, stream, fee with 2% buffer as current fee + bounded approval, maturity, cap) → approve PT → approve fee → sign → confirmed with borrow handoff
- [x] Both allowances already sufficient skip both checkpoints without renumbering
- [x] Deposit cap exceeded names the cap
- [x] Wrapped balance is immediately visible to repay-prepare shortfall math
- [x] Component tests green
- [ ] E2E wrap + deposit-create-stream on fork (deferred; this session ran Vitest only)

## Plan unit

U10 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
