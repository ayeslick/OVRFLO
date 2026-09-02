# 04 — Factory registration, replaceLending, and setLendingRouter

**What to build:** `registerOvrflo` still takes one argument. The factory reads `vault.reserve()` and `vault.ovrfloToken()`, checks runtime code and minter/reserve bindings, and records the reserve in write-once `ovrfloToReserve`. `OvrfloInfo` stays frozen. `replaceLending` admits a new market while the old market stays known for wind-down admin. `setLendingRouter` forwards `setRouter`. `sweepExcessUnderlying(ovrflo, to)` keeps its name and retargets the reserve. The reserve is not replaceable.

**Blocked by:** 03

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/04-factory-registration-replace.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not extend OvrfloInfo. Do not add
replaceReserve, unregister, or reserve-migration tooling.
Before any code, read Required reading below and the plan sections: Goal Capsule
stop conditions (b) and (c), KD6, KD7, KD10 factory forwarder, Sweep rules 1, 2, 5,
and 6, Verification Contract item 7 successors *Registration* and *replaceLending*,
and ### CS1 U4.
Rewrite the registerOvrflo NatSpec checklist for three creation transactions. Delete
the stale "Token ownership needs no check" sentence. Flash forwarder residue from 01
must be absent.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/04 in this worktree. Do not create another branch or
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
- `docs/solutions/patterns/ovrflo-coding-standard.md`
- `docs/solutions/patterns/ovrflo-style-guide.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (pattern #8, #9)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] `registerOvrflo` still takes one argument; `ovrfloToReserve(ovrflo)` is nonzero for an admitted column
- [ ] Missing code reverts `NoCode`; token minter mismatch reverts `TokenMinterMismatch`; reserve binding mismatch reverts `ReserveMismatch`
- [ ] A hostile vault whose token `reserve()` is not `vault.reserve()` is rejected
- [ ] A candidate whose reserve reports a foreign factory is rejected
- [ ] `ovrfloToReserve` is write-once; no `replaceReserve` exists
- [ ] `replaceLending`: `ovrfloToLending` is the new market; `registerLending` still reverts `LendingExists`; factory admin still reaches the old market; an old-market loan can `repay` / `close` / `claim`; `LendingReplaced` fires
- [ ] `replaceLending` appends the new market to `lendings` / `lendingCount` and keeps the old entry, so a reader can enumerate every market of a vault (KD7 web wind-down pin)
- [ ] The `replaceLending` NatSpec or the factory doc names the operator order: deploy the new market, `replaceLending(new)`, then `setLendingRouter` on the new market once a book bound to it exists
- [ ] `setLendingRouter` forwards to the market; factory re-emits
- [ ] `sweepExcessUnderlying(ovrflo, to)` calls the registered reserve
- [ ] `OvrfloInfo` tuple length and field order are unchanged
- [ ] Storage goldens regenerated via `check-storage-layout.sh --write`
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U4 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
