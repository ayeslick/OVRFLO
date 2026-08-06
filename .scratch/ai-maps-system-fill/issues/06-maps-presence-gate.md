# 06 — Maps presence gate

**What to build:** A mechanical presence check fails when UI/map-touching changes lack required companion artifacts (brief/state updates and/or scratch YAML / exemption per REVIEW). Agents and CI can run it before merge. No LLM semantic judgment in this ticket.

**Blocked by:** 01 — Maps operating charter; 02 — Six Markets region briefs; 03 — UI client state map

**Status:** resolved
edit (wording supplied); everything inside this ticket's file scope is done and verified.

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/06-maps-presence-gate.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not implement semantic LLM CI review.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U7, D8, KTD4.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- `docs/maps/REVIEW.md`, `docs/maps/SCHEMAS.md`
- Existing script/test patterns for banned-patterns or similar gates
- this ticket's acceptance criteria

- [x] Presence-gate script (or equivalent) exists and is documented for agent invocation
      — `tools/scripts/check-maps-presence.sh` (`--help`), wired as
      `npm --prefix web run lint:maps`
- [x] Touching Markets UI / maps UI paths without required companions fails a documented negative fixture
      — `web/tests/fixtures/maps-presence-ui-change-no-companion.txt` → exit 1
- [x] Docs-only charter edits without UI code can pass without scratch
      — `web/tests/fixtures/maps-presence-docs-only-charter-edit.txt` → exit 0
- [x] Gate does not attempt semantic LLM review
      — path-list decisions only; no network, no model call, no source reading
- [x] REVIEW.md or charter links how/when to run the gate — applied by the orchestrator: `docs/maps/REVIEW.md` § Mechanical gates now documents the three rules, the exact-path exemption discipline, and `npm --prefix web run lint:maps`. `docs/maps/README.md` fill status reads `wired`.
      — **orchestrator-owned edit.** `docs/maps/REVIEW.md` is outside this
      ticket's file scope this wave; the exact "Mechanical gates" wording was
      handed to the orchestrator in the U7 report and lands in the same commit.
- [x] Any wrapper test stays green in the normal web/test or tools invocation path
      — `web/tests/scripts/maps-presence.test.ts`, 17 passing under
      `npm --prefix web run test`

## Plan unit

U7 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
