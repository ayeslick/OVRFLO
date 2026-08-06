# 07 — Stack-fitness scorecard

**What to build:** A scorecard document an Owner can use later to judge whether the current Next/React Markets client meets the AI-maintainability bar versus alternatives — using evidence from the filled state map and region briefs. This ticket does **not** migrate the stack or choose a replacement.

**Blocked by:** 02 — Six Markets region briefs; 03 — UI client state map

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U8 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/07-stack-fitness-scorecard.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not change web/ dependencies or migrate frameworks.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U8, D9, R9–R10.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- Filled `docs/maps/state/` catalog and six region briefs
- Plan D9 / R9 / AE4
- this ticket's acceptance criteria

- [x] `docs/maps/STACK_FITNESS.md` (or equivalent) exists with scored dimensions (AI reasonability of state graph, trust-domain honesty, testability, wallet/EVM ecosystem fit, operational cost)
- [x] Scorecard can be filled using only maps/briefs as evidence inputs
- [x] Document states explicitly that no stack migration is decided or performed in this feature
- [x] Charter or maps README links the scorecard as a later Owner-directed review — applied by the orchestrator: `docs/maps/README.md` Files table and fill-status row now name it, and both the charter's out-of-scope bullet and `REVIEW.md`'s escalation section link it (the stale "not yet written" parenthetical is gone).
- [x] No `web/` dependency or framework change ships in this ticket

**Note on the unticked box.** `docs/maps/README.md` is outside this worker's file
scope (two other tickets are editing it concurrently). The exact link line is handed
to the orchestrator in the final report; tick this box once it lands.

## Plan unit

U8 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
