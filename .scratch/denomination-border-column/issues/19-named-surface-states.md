# 19 — Named request, waiting, transaction, and edge states

**What to build:** Every named surface state has at most one primary next action and at most one secondary recovery action. Quote refreshing and transaction pending may have no primary button and must suppress stale submit. Waiting requests and unmatched Fixed Return supply are active positions, not empty states. Retired-router execute is disabled and cancel is preserved. PT claim and unwrap stay separate exits. Caught render errors join the same resume contract as other failed steps.

**Blocked by:** 10, 15, 16, 17

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/19-named-surface-states.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not wait on 18. Do not invent
request-book contract behavior; consume CS3 canonical post/execute/wait/cancel.
If ticket 10 is not resolved, do not claim this ticket.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD7 web wind-down pin, KD14
request states and resting truth, KD16 waiting copy, AS9, ### CS4-U5, and
Verification Contract successors *State-action contract*, *Separate exits*,
*Immediate-total honesty*, *Retired market wind-down*.
Closing the modal is not cancelling the attempt. Every reset path is resume (17).
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/19 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `DESIGN.md`
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- ticket 10 (CS3 canonical actions this UI consumes)
- ticket 17 (resume contract this UI must not fork)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Scratch intent capsule exists before the first state-touching edit
- [x] Every named state renders no more than one primary and one secondary action; quote refreshing and pending may render no primary
- [x] Quote refreshing and transaction pending suppress all stale submit paths
- [x] Transaction rejected, reverted, pending, confirmed, and unknown remain distinct and announce the correct next action
- [x] Liquidity unavailable can post a request only when CS3 is available; the confirmed request becomes waiting for liquidity
- [x] No borrower demand yet remains reachable as an unmatched Fixed Return supply state with a valid next action and withdrawable funds
- [x] Market moved requires refreshed review before submission
- [x] Retired-router state disables execute and preserves cancel
- [x] Retired-market position offers repay, close, claim, and liquidity withdraw; never offers supply, borrow, or request post; `Default` copy is the KD7 sentence
- [x] Waiting-for-liquidity copy states that vested ovrfloToken stays in the stream until cancel or loan close, and that a request past series maturity cannot fill and must be cancelled
- [x] The request-post authorization leg names the book as ERC-721 spender, not the lending market
- [x] Completed position exposes detail; PT claim appears only with maturity and PT backing; unwrap appears whenever `OVRFLOReserve` and wallet ovrfloToken balance permit
- [x] Network/read failure never renders authoritative zero or empty portfolio
- [x] Caught render error records region and execution phase and offers persisted-attempt resume rather than a blind restart
- [x] Status uses text and icon; color is supplementary

## Plan unit

CS4-U5 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Deviations

- Request discovery enumerates `1..nextRequestId-1` and sets the same incomplete
  flag as `loansOf` when the cap is hit. The session does not add a log scan.
- Post rebuild sets `eligible: true` the same way the existing borrow snapshot
  load does. The book contract still rejects an ineligible stream on `post`.
