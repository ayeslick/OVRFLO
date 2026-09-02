# 24 — Classify ESLint/Oxlint parity

**What to build:** Every ESLint versus Oxlint difference is classified A–E in `web/oxlint-eslint-parity.md`. ESLint may be removed only when the ledger has zero unclassified items and zero C items, and no-console plus scripts-override fixtures still pass. Anti-slop rules enable only with named repo evidence. Classify from a real same-source run. Do not invent rows for rules that did not differ.

**Blocked by:** 23

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS7-U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/24-eslint-oxlint-parity.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not land Oxfmt output (25).
Do not treat a retained external gate as closure for a C item.
Do not mark generated ABI as class D; ESLint currently lints those files.
Read Required reading below and the plan sections: KD20 A–E classes, ### CS7-U2,
and CS7 Definition of Done.
If parity is not achieved, ESLint remains and this ticket records the blocker
instead of removing ESLint.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/24 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD20 and CS7-U2
- `web/oxlint-eslint-parity.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Same-source runs produce a complete classified difference set in `web/oxlint-eslint-parity.md` with no unmatched finding
- [ ] A C gap keeps the ESLint command active
- [ ] A D exception is narrow and does not suppress unrelated files
- [ ] An E decision includes a reproducer or rule-support reference rather than an unexplained disable
- [ ] No-console and scripts-override fixtures behave identically before and after any ESLint removal
- [ ] Any unclassified or C ledger entry blocks ESLint removal
- [ ] Anti-slop rules that were enabled cite concrete repo evidence and expected remediation
- [ ] Independent TypeScript, maps, test, axe, and build gates remain

## Plan unit

CS7-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
