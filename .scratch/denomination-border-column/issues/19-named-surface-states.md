# 19 — Named request, waiting, transaction, and edge states

**What to build:** Every named surface state has at most one primary next action and at most one secondary recovery action. Quote refreshing and transaction pending may have no primary button and must suppress stale submit. Waiting requests and unmatched Fixed Return supply are active positions, not empty states. Retired-router execute is disabled and cancel is preserved. PT claim and unwrap stay separate exits. Caught render errors join the same resume contract as other failed steps.

**Blocked by:** 10, 15, 16, 17

**Status:** ready-for-agent
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
Read Required reading below and the plan sections: KD14 request states, KD16
waiting copy, AS9, ### CS4-U5, and Verification Contract successors
*State-action contract*, *Separate exits*, *Immediate-total honesty*.
Closing the modal is not cancelling the attempt. Every reset path is resume (17).
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

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Every named state renders no more than one primary and one secondary action; quote refreshing and pending may render no primary
- [ ] Quote refreshing and transaction pending suppress all stale submit paths
- [ ] Transaction rejected, reverted, pending, confirmed, and unknown remain distinct and announce the correct next action
- [ ] Liquidity unavailable can post a request only when CS3 is available; the confirmed request becomes waiting for liquidity
- [ ] No borrower demand yet remains reachable as an unmatched Fixed Return supply state with a valid next action and withdrawable funds
- [ ] Market moved requires refreshed review before submission
- [ ] Retired-router state disables execute and preserves cancel
- [ ] Completed position exposes detail; PT claim appears only with maturity and PT backing; unwrap appears whenever `OVRFLOReserve` and wallet ovrfloToken balance permit
- [ ] Network/read failure never renders authoritative zero or empty portfolio
- [ ] Caught render error records region and execution phase and offers persisted-attempt resume rather than a blind restart
- [ ] Status uses text and icon; color is supplementary

## Plan unit

CS4-U5 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
