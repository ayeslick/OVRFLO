# 08 — Docs sync

**What to build:** Docs describe the nested column and ovrfloToken denomination. Architecture, concepts, onboarding, security, product operating context, critical patterns, rejected-finding pointers, and x-ray match the shipped CS1 surface. This ticket does not rewrite CS4 product UX. CS0 (the two README line fixes) already shipped on 2026-09-01 and is not part of this ticket.

**Blocked by:** 06, 07

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U8 only (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/08-docs-sync.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not change Solidity or web
behavior. Maps wrap-reserve retarget belongs to 07 — verify it is present, do not
relitigate it. CS0 already shipped; do not redo it.
Before any edits, read Required reading below and the plan sections: KD13
doc consequences, ### CS1 U8, Sweep rule 12, and Definition of Done CS1.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/08 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/agents/onboarding.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- `docs/audit/rejected-findings-record.md` (R-02 pointer follows the sweep to the reserve)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] README architecture sections describe `OVRFLOReserve`, two named minters, ovrfloToken lending escrow, and nested deploy
- [ ] `CONCEPTS.md` has an `OVRFLOReserve` entry, three labeled exits, and denomination vocabulary
- [ ] `docs/agents/onboarding.md` §2/§4/§5/§7 combined solvency and live map match KD13. Do not restore an Architecture Overview into `AGENTS.md`; that file stays the session router.
- [ ] `docs/agents/onboarding.md` §2 file list names every file in `src/`, including `OVRFLOStreamLens.sol` (deployless read lens; not a DeploySize deployable) and the new `OVRFLOReserve.sol`. The "six Solidity files" sentence is corrected to the real count.
- [ ] Critical patterns fee denomination and sweep-reserve reasoning move to the reserve
- [ ] `VAULT_SECURITY.md` records two burn authorities
- [ ] `PRODUCT.md` Operating Context: lender-supply and borrower-proceeds references are ovrfloToken; `underlying` stays column identity
- [ ] R-02 rejected-finding pointer follows the sweep to the reserve
- [ ] `x-ray/` refresh matches the post-CS1 contracts
- [ ] Grep for PT flash as a live vault facility returns hits only in historical plans, audits, or this ticket's "removed" wording

## Plan unit

CS1 U8 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
