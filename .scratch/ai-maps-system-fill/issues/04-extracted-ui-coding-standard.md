# 04 — Extracted UI coding standard

**What to build:** A thin, enforceable UI coding standard distilled from the filled region briefs — checklist form agents and mechanical checks can use — without duplicating full control tables. Link it from the Maps UI index/charter. Extend banned-pattern enforcement only for durable, mechanical bans already implied by briefs.

**Blocked by:** 02 — Six Markets region briefs

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/04-extracted-ui-coding-standard.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not rewrite DESIGN.md as a pre-build rulebook. Do not restate entire region briefs.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U4, D5.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- All six region briefs from ticket 02
- `docs/maps/SCHEMAS.md`
- Existing banned-pattern enforcement (if extending)
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (only where UI honesty overlaps)
- this ticket's acceptance criteria

- [x] `docs/maps/ui/CODING_STANDARD.md` exists as a short checklist
- [x] Each standard item cites originating brief region or control IDs
- [x] Standard covers state honesty, forbidden product framing, and Supply/Borrow peer semantics at checklist depth
- [x] Charter or UI README links the standard — applied by the orchestrator: `docs/maps/README.md` Files table now carries `ui/CODING_STANDARD.md`, and the fill-status row reads `extracted — 40 rules, all brief-cited`.
- [x] Banned-patterns suite stays green; new bans only if clearly mechanical
- [x] Standard does not duplicate full control inventories

## Plan unit

U4 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
