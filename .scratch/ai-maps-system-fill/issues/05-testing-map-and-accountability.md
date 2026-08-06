# 05 — Testing map and accountability upgrade

**What to build:** The web testing catalog truthfully describes the current suite and how each area fits the larger quality story. Test-accountability requires a modification reason and supports dual-agent review references — not Owner approval for routine updates. Gherkin stays flow-level; cheap control-ID tags are welcome, bulk 1:1 tagging is not required.

**Blocked by:** 01 — Maps operating charter

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/05-testing-map-and-accountability.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not require human sign-off for routine test changes.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U5, D6, D8.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- `docs/maps/REVIEW.md` (dual-agent review — from ticket 01)
- Current `web/reviews/testing.md` and `web/reviews/test-accountability.md`
- Inventory of current `web/tests` unit/component and e2e feature files
- this ticket's acceptance criteria

- [x] `web/reviews/testing.md` matches the current test tree (paths/counts/purpose) at time of update
- [x] Each catalog entry states purpose and role in the larger picture
- [x] Accountability template requires modification reason when tests are deleted, rewritten, or weakened
- [x] Accountability supports agent-reviewer pass references (not mandatory Owner approval)
- [x] Policy states Gherkin remains flow-level with optional control-ID tags (pass 1)
- [x] No requirement that humans review every test change

## Resolution notes (2026-08-03)

Inventory taken 2026-08-03 on `feat/ai-maps-system-fill`: **66** unit/component test
files, **714** cases (713 pass, 1 pre-existing failure in
`tests/components/markets-table.test.tsx`), **6** Gherkin features / **31** scenarios,
plus 2 out-of-band live-parity files and 1 type-boundary file. The previous catalog's
"45 tests across 11 files" was stale, and every filename it cited had been deleted or
renamed — the rewrite is area-keyed so it survives the next refactor.

Review contract implemented against the **current** `docs/maps/REVIEW.md`: routes to
`ce-code-review` / `ce-doc-review` with a risk-driven roster. No fixed two-lens
language, and no human sign-off requirement.

Out of scope, reported not done:
- e2e control-ID tagging (`web/tests/e2e/*.feature`) — optional at pass 1; test files
  were outside this session's file scope. No tags exist today, which is compliant.
- `tests/components/markets-table.test.tsx` failure — recorded in the catalog as known
  red; diagnosing it needs a test/component edit this session did not own.
- `web/reviews/` is gitignored (`.gitignore:62`), so `testing.md` is untracked while
  `test-accountability.md` is force-added. Presence gates can only observe tracked
  files.

## Plan unit

U5 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
