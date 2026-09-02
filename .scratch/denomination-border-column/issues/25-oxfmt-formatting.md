# 25 — Oxfmt formatting-only commit

**What to build:** Oxfmt output lands in a separate formatting-only commit after rule-migration behavior is green. The first run produces only syntactic formatting changes. The second run produces no diff. Independent correctness, accessibility, policy, and build gates stay green. Do not rewrite `web/lib/generated.ts` or `web/lib/generated/lens-bytecode.ts`.

**Blocked by:** 24

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
Implement this ticket directly. Do not run /ce-work; the acceptance criteria
are the checklist. Plan: docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS7-U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/25-oxfmt-formatting.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not mix dependency, rule, or
behavior changes into the formatting commit.
Read Required reading below and the plan sections: KD20 Oxfmt paragraph, ### CS7-U3,
and Verification Contract item 8 (formatter output reviewed in a separate diff).
Run npm --prefix web run fmt:oxfmt twice. Require the second run to produce no
diff. Prove check mode with fmt:oxfmt:check.
Branch: work on ticket/25 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD20 and CS7-U3
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] The first formatter run produces only syntactic formatting changes
- [ ] The second formatter run is idempotent
- [ ] `fmt:oxfmt:check` is clean after the second write
- [ ] TypeScript, independent policy gates, Vitest, Playwright, axe, and production build results are unchanged after formatting
- [ ] The formatting commit contains no logic or configuration change
- [ ] `web/lib/generated.ts` and `web/lib/generated/lens-bytecode.ts` are not rewritten

## Plan unit

CS7-U3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
