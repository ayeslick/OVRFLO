# 23 — Add Ultracite, Oxlint, and Oxfmt commands

**What to build:** New native rule families and format commands run beside the current checks. ESLint stays. TypeScript, banned-pattern, dependency, maps, Vitest, Playwright, axe, and production build remain separately runnable. No type-aware Oxlint. No TypeScript 7. Current no-console policy and scripts override stay. Config files and pins are KD20.

**Blocked by:** 08, 13, 14, 18, 20, 21, owner start-OK

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
Implement this ticket directly. Do not run /ce-work; the acceptance criteria
are the checklist. Plan: docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS7-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/23-ultracite-oxlint-oxfmt-commands.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not remove ESLint (24). Do not
commit formatter output (25). Do not wait on 09, 10, or 22.
STOP if the owner has not recorded start-OK on this ticket. Pins are KD20.
Do not re-research pins. Do not run npx ultracite init. Do not spread
core.ignorePatterns. Do not enable js-plugins, anti-slop, or type-aware Oxlint.
Write web/oxlint.config.ts and web/oxfmt.config.ts exactly as KD20 shows them.
Create web/oxlint-eslint-parity.md with the six-column header only.
Read Required reading below and the plan sections: KD20, AS8, sweep rule 14,
### CS7-U1, CS7 stop conditions, and Verification Contract successor
*Tool parity*.
Branch: work on ticket/23 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD20 and CS7-U1
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Owner recorded start-OK on this ticket before the first install
- [ ] `npm ls ultracite oxlint oxfmt` is `7.10.7`, `1.80.0`, and `0.65.0`
- [ ] `web/oxlint.config.ts` and `web/oxfmt.config.ts` match KD20
- [ ] Scripts `lint:oxlint`, `fmt:oxfmt`, and `fmt:oxfmt:check` exist; `lint` is still `eslint .`
- [ ] `web/lib/generated.ts` and `web/lib/generated/lens-bytecode.ts` remain in both ESLint and Oxlint file sets
- [ ] A representative console violation still fails in application code and remains allowed only where the existing scripts override permits it
- [ ] React, Next, and Vitest fixture violations are checked by the intended native rule family
- [ ] Running lint does not implicitly replace TypeScript, tests, accessibility, maps, dependency, or build gates
- [ ] Dependency inspection proves no TypeScript 7 or type-aware Oxlint path was introduced
- [ ] `AGENTS.md` is still the session router
- [ ] `web/oxlint-eslint-parity.md` exists with the six-column header
- [ ] ESLint remains installed and runnable

## Plan unit

CS7-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
