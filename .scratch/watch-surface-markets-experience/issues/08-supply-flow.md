# 08 — Supply flow

**What to build:** Supply from market select through confirmed receipt in the spacious composition: amount, three-tick stepper with queue band, split review, PERMISSION/ACTION receipts. A confirmed supply appears on the watch wall as a resting row.

**Blocked by:** 04 — Component kit; 06 — Hooks + executor re-anchor; 07 — Shell + watch surface

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U8 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/08-supply-flow.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not implement Borrow or Assets. Follow the supply brief and flow-spec Supply table.
Before any writes, read Required reading below and the plan sections: Goal Capsule, R13–R14, KTD5, KTD7, ### U8, flow-spec Supply (read-only).
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R13–R14, ### U8, Verification Contract see-equals-sign and WIG gates
- Supply and review briefs from ticket 02
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` Supply table + exceptions (read-only)
- `docs/agents/testing.md` before E2E
- this ticket's acceptance criteria

- [x] Full supply path reaches CONFIRMED with position identity in the receipt
- [x] Amount field has truthful MAX and inline unit/minimum feedback; exact minimum supply works
- [x] Rate window steps one tick; paddles disable with reason at bounds; queue band shows literal place
- [x] Split review shows exact-allowance PERMISSION RECEIPT and ghosted ACTION RECEIPT
- [x] Approval checkpoint is skipped-not-renumbered when allowance suffices; two-state approval guard; four-state action ladder
- [x] Allowance rejected stays at checkpoint; revert decodes to copy + recovery; quote/config drift returns to rate select
- [x] Market matured returns to market select with amount preserved
- [ ] Confirmed supply appears on the watch wall as resting — remaining-gap U14 (E2E); `VIEW POSITION` navigates to `/?lens=supplied&position=` (watch row is U7)
- [x] Component tests green
- [ ] E2E supply happy path on fork lands view-position → watch row — remaining-gap U14

## Plan unit

U8 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
