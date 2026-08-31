# 23 — Add Ultracite, Oxlint, and Oxfmt commands

**What to build:** New native rule families and format commands run beside the current checks. ESLint stays. TypeScript, banned-pattern, dependency, maps, Vitest, Playwright, axe, and production build remain separately runnable. No type-aware Oxlint. No TypeScript 7. Current no-console policy and scripts override stay.

**Blocked by:** 08, 13, 14, 20, 21

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS7-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/23-ultracite-oxlint-oxfmt-commands.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not remove ESLint (24). Do not
commit formatter output (25). Do not wait on 09, 10, or 18.
STOP before implementation if reviewers have not recorded exact Ultracite, Oxlint,
and Oxfmt pins; supported configuration paths; common include/exclude scope; and
the checked-in A–E parity-ledger path. Do not invent unsupported configuration
filenames.
Read Required reading below and the plan sections: KD20, AS8, ### CS7-U1, CS7
stop conditions, and Verification Contract successor *Tool parity*.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD20 and CS7-U1
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Reviewed exact pins, supported configuration paths, common scope, and ledger path are recorded before the first install
- [ ] A representative console violation still fails in application code and remains allowed only where the existing scripts override permits it
- [ ] React, Next, and Vitest fixture violations are checked by the intended native rule family
- [ ] Running lint does not implicitly replace TypeScript, tests, accessibility, maps, dependency, or build gates
- [ ] Dependency inspection proves no TypeScript 7 or type-aware Oxlint path was introduced
- [ ] Package and configuration fixtures prove every tool uses the reviewed exact pin and supported configuration path
- [ ] ESLint and Oxlint report over the same include/exclude file set
- [ ] ESLint remains installed and runnable

## Plan unit

CS7-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
