# 08 — Docs sync

**What to build:** Docs describe the nested column and ovrfloToken denomination. Architecture, concepts, onboarding, security, product operating context, critical patterns, rejected-finding pointers, and x-ray match the shipped CS1 surface. This ticket does not rewrite CS4 product UX. CS0 (the two README line fixes) already shipped on 2026-09-01 and is not part of this ticket.

**Blocked by:** 07 (06 is deferred; onboarding §5 describes the invariants as pinned in KD13, not as re-derived)

**Status:** resolved
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

- [x] README architecture sections describe `OVRFLOReserve`, two named minters, ovrfloToken lending escrow, and nested deploy
- [x] `CONCEPTS.md` has an `OVRFLOReserve` entry, three labeled exits, and denomination vocabulary
- [x] `docs/agents/onboarding.md` §2/§4/§5/§7 combined solvency and live map match KD13. Do not restore an Architecture Overview into `AGENTS.md`; that file stays the session router.
- [x] `docs/agents/onboarding.md` §2 file list names every file in `src/`, including `OVRFLOStreamLens.sol` (deployless read lens; not a DeploySize deployable) and the new `OVRFLOReserve.sol`. The "six Solidity files" sentence is corrected to the real count.
- [x] Critical patterns fee denomination and sweep-reserve reasoning move to the reserve
- [x] `VAULT_SECURITY.md` records two burn authorities
- [x] `PRODUCT.md` Operating Context: lender-supply and borrower-proceeds references are ovrfloToken; `underlying` stays column identity
- [x] R-02 rejected-finding pointer follows the sweep to the reserve
- [x] `x-ray/` refresh matches the post-CS1 contracts
- [x] Grep for PT flash as a live vault facility returns hits only in historical plans, audits, or this ticket's "removed" wording

## Plan unit

CS1 U8 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session log

Intent recorded 2026-09-02 before the first docs write.

Assumptions: CS1 U1–U7 are on this checkout. Ticket 06 is deferred, so onboarding §5 describes KD13 as pinned, not as re-derived. Maps wrap-reserve retarget shipped in ticket 07. CS2 flash mint and CS3 request book stay later-unit vocabulary. CS0 README two-line fixes stay. `AGENTS.md` stays the session router.

This ticket owns: docs that describe the shipped CS1 column. Ticket 07 owns maps wrap-reserve retarget (verify only). Ticket 09 owns CS2 flash mint. Ticket 10 owns the request book. Ticket 06 owns invariant re-derivation.

Predicted blast radius: `README.md`, `CONCEPTS.md`, `docs/agents/onboarding.md`, `docs/agents/system.md` (live column wiring), `docs/solutions/patterns/ovrflo-critical-patterns.md`, `VAULT_SECURITY.md`, `PRODUCT.md` Operating Context, `docs/audit/rejected-findings-record.md` (R-02), `x-ray/x-ray.md`, `x-ray/entry-points.md`, `x-ray/invariants.md`, `x-ray/flash-loan-invariant-check.md`, this ticket file. No Solidity. No web behavior. No map rewrite.

Deviation (owner 2026-09-02, this session): delete the README `## Roadmap` section. That section named a stale Pool product and still described lenders pooling underlying. CS0 only reworded one line in it; this ticket removes the section.

Deviation (2026-09-02, this session): the spec reviewer subagent (`gpt-5.6-sol-medium`) could not launch (Cursor unpaid-invoice error). This chat reviewed the uncommitted diff against live `src/`. Fixes from that pass: drop `IFlashBorrower` from the onboarding interfaces list; CONCEPTS `ovrfloToken` names both minters; CR-L2 no longer calls the vault the sole minter.

Verification: PT-flash grep as a live vault facility; onboarding §2 file list vs `src/*.sol`; maps wrap-reserve already on `OVRFLOReserve`; `git diff --stat` vs this list. `AGENTS.md` is unchanged.

Reuse: retarget existing README diagram, CONCEPTS entries, onboarding tables, and x-ray templates. No new doc format.
