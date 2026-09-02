# 03 — Lending asset switch and router hook

**What to build:** The lending market escrows, pays, and fees in ovrfloToken. The market drops stored `underlying` but still reads the frozen `ovrfloInfo` tuple, including the nonzero underlying check. `borrow` takes a final `onBehalfOf`. A router caller attributes, pays, and indexes that address; any other caller is always the borrower. `Borrowed` emits the attributed borrower on the existing indexed topic. `setRouter` exists on the market in this ticket; the factory forwarder lands in 04.

**Blocked by:** 02

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/03-lending-asset-router.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not change StreamPricing math or
_fillTick. Do not add the factory forwarder (04). Do not add supplyWithPermit or
repayWithPermit.
Before any code, read Required reading below and the plan sections: Goal Capsule
stop condition (d) and (f), KD9, KD10, Sweep rules 4 and 6, Verification Contract
item 7 successors *Lending single-asset* and *Router hook*, and ### CS1 U3.
Declare router after the last existing storage variable. If
test_Lending_RetainsRuntimeHeadroomCanary fails, drop the hook, keep the asset
switch, surface, and do not lower LENDING_RUNTIME_CANARY. Do not run or gate on
the web build; that is ticket 07's gate. Owner reaches setRouter directly until 04 lands —
both land before merge.
Fuzz and invariant files: minimum edit to keep plain forge test green, nothing
more. Do not run FOUNDRY_PROFILE=invariant or the fizz harness. 06 owns the
re-derivation later; log each minimum edit on this ticket.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/03 in this worktree. Do not create another branch or
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
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- `docs/audit/rejected-findings-record.md` (L-12 — do not add a self-match guard)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] `supply` pulls ovrfloToken; `withdraw` refunds ovrfloToken; no underlying balance changes on those paths
- [ ] `borrow` pays net ovrfloToken to the attributed borrower and fee ovrfloToken to the treasury
- [ ] `repay`, `close`, `claim`, `proceeds`, and `received` stay ovrfloToken; `_fillTick` and StreamPricing are unchanged
- [ ] Constructor still reads `ovrfloInfo` and still reverts on zero underlying; it does not store `underlying`
- [ ] A non-router caller who passes a wrong `onBehalfOf` still owns the loan
- [ ] A router call with `onBehalfOf = human` pays, indexes, and (on close) returns the stream to the human
- [ ] A router call with `onBehalfOf = address(0)` reverts `ZeroAddress`
- [ ] `Borrowed` indexed `borrower` is the attributed address; no fourth indexed topic is added
- [ ] `previewBorrow` keeps its four-argument signature
- [ ] `setRouter` accepts zero or any nonzero address; one event `LendingRouterSet`
- [ ] Lending runtime canary still holds, or the hook is dropped and the failure is surfaced without lowering the canary
- [ ] Storage goldens regenerated via `check-storage-layout.sh --write`; raw-slot constants follow the golden
- [ ] `forge build` then `forge test` green; `forge fmt --check` clean. The web build is not a gate here; `borrow` gains `onBehalfOf` and the web call sites flip in 07

## Plan unit

CS1 U3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
