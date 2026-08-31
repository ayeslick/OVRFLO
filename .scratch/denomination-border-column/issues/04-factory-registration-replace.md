# 04 — Factory registration, replaceLending, and setLendingRouter

**What to build:** `registerOvrflo` still takes one argument. The factory reads `vault.border()` and `vault.ovrfloToken()`, checks runtime code and minter/border bindings, and records the border in write-once `ovrfloToBorder`. `OvrfloInfo` stays frozen. `replaceLending` admits a new market while the old market stays known for wind-down admin. `setLendingRouter` forwards `setRouter`. `sweepExcessUnderlying(ovrflo, to)` keeps its name and retargets the border. The border is not replaceable.

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
replaceBorder, unregister, or reserve-migration tooling.
Before any code, read Required reading below and the plan sections: Goal Capsule
stop conditions (b) and (c), KD6, KD7, KD10 factory forwarder, Sweep rules 1, 2, 5,
and 6, Verification Contract item 7 successors *Registration* and *replaceLending*,
and ### CS1 U4.
Rewrite the registerOvrflo NatSpec checklist for three creation transactions. Delete
the stale "Token ownership needs no check" sentence. Flash forwarder residue from 01
must be absent.
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

- [ ] `registerOvrflo` still takes one argument; `ovrfloToBorder(ovrflo)` is nonzero for an admitted column
- [ ] Missing code reverts `NoCode`; token minter mismatch reverts `TokenMinterMismatch`; border binding mismatch reverts `BorderMismatch`
- [ ] A hostile vault whose token `border()` is not `vault.border()` is rejected
- [ ] A candidate whose border reports a foreign factory is rejected
- [ ] `ovrfloToBorder` is write-once; no `replaceBorder` exists
- [ ] `replaceLending`: `ovrfloToLending` is the new market; `registerLending` still reverts `LendingExists`; factory admin still reaches the old market; an old-market loan can `repay` / `close` / `claim`; `LendingReplaced` fires
- [ ] `setLendingRouter` forwards to the market; factory re-emits
- [ ] `sweepExcessUnderlying(ovrflo, to)` calls the registered border
- [ ] `OvrfloInfo` tuple length and field order are unchanged
- [ ] Storage goldens regenerated via `check-storage-layout.sh --write`
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

CS1 U4 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
