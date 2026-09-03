# 04 — Factory registration, replaceLending, and setLendingRouter

**What to build:** `registerOvrflo` still takes one argument. The factory reads `vault.reserve()` and `vault.ovrfloToken()`, checks runtime code and minter/reserve bindings, and records the reserve in write-once `ovrfloToReserve`. `OvrfloInfo` stays frozen. `replaceLending` admits a new market while the old market stays known for wind-down admin. `setLendingRouter` forwards `setRouter`. `sweepExcessUnderlying(ovrflo, to)` keeps its name and retargets the reserve. The reserve is not replaceable.

**Blocked by:** 03

**Status:** resolved
**Labels:** ready-for-human

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
Fuzz and invariant files: minimum edit to keep plain forge test green, nothing
more. Do not run FOUNDRY_PROFILE=invariant or the fizz harness. 06 owns the
re-derivation later; log each minimum edit on this ticket.
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

- [x] `registerOvrflo` still takes one argument; `ovrfloToReserve(ovrflo)` is nonzero for an admitted column
- [x] Missing code reverts `NoCode`; token minter mismatch reverts `TokenMinterMismatch`; reserve binding mismatch reverts `ReserveMismatch`
- [x] A hostile vault whose token `reserve()` is not `vault.reserve()` is rejected
- [x] A candidate whose reserve reports a foreign factory is rejected
- [x] `ovrfloToReserve` is write-once; no `replaceReserve` exists
- [x] `replaceLending`: `ovrfloToLending` is the new market; `registerLending` still reverts `LendingExists`; factory admin still reaches the old market; an old-market loan can `repay` / `close` / `claim`; `LendingReplaced` fires
- [x] `replaceLending` appends the new market to `lendings` / `lendingCount` and keeps the old entry, so a reader can enumerate every market of a vault (KD7 web wind-down pin)
- [x] The `replaceLending` NatSpec or the factory doc names the operator order: deploy the new market, `replaceLending(new)`, then `setLendingRouter` on the new market once a book bound to it exists
- [x] `setLendingRouter` forwards to the market; factory re-emits
- [x] `sweepExcessUnderlying(ovrflo, to)` calls the registered reserve
- [x] `OvrfloInfo` tuple length and field order are unchanged
- [x] Storage goldens regenerated via `check-storage-layout.sh --write`
- [x] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U4 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session log

Fuzz and invariant files: no minimum edits. Plain `forge test` stayed green without touching those suites.

Deviation: `registerOvrflo` checks `reserve == address(0)` before `code.length`. KD6 listed `NoCode` first. `address(0).code.length` is 0, so that order made `ReserveMismatch` unreachable for a missing reserve. The named error for a missing reserve stays `ReserveMismatch`.

Review: GPT-5.6 Sol reported two lows (dead zero-reserve selector; duplicate `lendings` on repeat replace). Both applied. Grok 4.6 second pass reported no findings.

`test/mocks/MockOvrfloAdmin.sol` already forwarded sweep to the reserve in ticket 02. This ticket did not change that mock.

## Follow-up (2026-09-03) — prior router history

User-directed. `setLendingRouter` now appends the outgoing nonzero router to
`priorRouterCount` / `priorRouterAt` / `isPriorRouter`. No `book.lending()`
match check. Current pointer stays `lending.router()`.

Deviation: plan line 204 says `execute` on the old book reverts after the Safe
sets the new market's router. Code: `replaceLending` never writes
`oldLending.router`, and `OVRFLOLending.borrow` reads only `router`. The
runbook now requires `setLendingRouter(oldLending, address(0))` after
`replaceLending` so the old book stops filling and stays listed for `cancel`.
The plan file was not edited.
