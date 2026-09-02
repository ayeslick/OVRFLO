# 01 — Delete PT flash

**What to build:** The vault no longer offers a PT flash loan. Flash functions, storage, events, errors, factory forwarders, the flash-borrower interface, and the flash test surface are gone. The vault drops `ReentrancyGuard`. This commit is pure removal and must land before reserve extraction so later diffs do not mix deletion with the structural move.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
Implement this ticket directly. Do not run /ce-work; the acceptance criteria
are the checklist. Plan: docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/01-delete-pt-flash.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not extract OVRFLOReserve. Do not
change denomination, minters, or lending.
Before any code, read Required reading below and the plan sections: Goal Capsule,
KD1, Sweep rule 8 (error-catalog regeneration rides this unit), Verification
Contract item 7 successor *Flash surface gone*, and ### CS1 U1.
This commit is pure removal. Regenerate the ABI-enumerated error catalog in the
same commit — the catalog test hard-fails when flash errors leave the vault ABI.
Branch: work on ticket/01 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Vault ABI has no `flashLoan`, `flashFeeBps`, `flashLoanPaused`, `setFlashFeeBps`, or `setFlashLoanPaused`
- [ ] Factory has no flash forwarders
- [ ] `IFlashBorrower` is deleted
- [ ] Vault no longer inherits `ReentrancyGuard`
- [ ] Flash unit, fork, fuzz, attack, invariant, and fizz members listed in KD1 are deleted
- [ ] Web error-catalog test matches the post-removal vault ABI
- [ ] Successor *Flash surface gone* holds
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
