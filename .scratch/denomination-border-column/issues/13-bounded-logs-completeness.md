# 13 — Bounded logs and progressive portfolio completeness

**What to build:** Portfolio log reads are bounded and owned by one discovery module. Stream and lending modules hydrate candidate IDs and never call `getLogs`. Missing pages and failed hydration return `partialOutcome` with `complete: false`. Factory and bootstrap discovery stay fail-closed. Logs never authorize a write. Scanner output is display-only.

**Blocked by:** 12

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS5-U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/13-bounded-logs-completeness.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add deployless probes (14).
Do not let logs enter action gating. CS4-U2 may consume this contract if 15 lands
later; this ticket must remain correct without CS4 routing.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD18 logs bullets, AS7, AS10,
### CS5-U2, and Verification Contract successor *Read authority* / *Read policy
and ownership*.
Remove StreamBook.complete or derive it from the outer result so outer-ready and
inner-incomplete cannot coexist. Update the banned-pattern fixture to permit only
the named discovery owner.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/maps/SCHEMAS.md` §2 and §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] An oversized log range is divided and merged without duplicate or missing candidate identifiers
- [ ] One provider failure mid-range yields explicitly partial portfolio output until fallback completes
- [ ] A log that names an old owner loses to an authoritative current-owner read
- [ ] Factory discovery fails closed on any required registration leg
- [ ] A missing page or one failed candidate hydration yields `partialOutcome` and `complete: false`
- [ ] Banned-pattern fixture rejects `getLogs` outside the named discovery owner
- [ ] No result can be outer-ready while an inner stream book reports incomplete
- [ ] Watch E2E never treats logs as ownership authority

## Plan unit

CS5-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
