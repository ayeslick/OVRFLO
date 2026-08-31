# 16 — Self-Repaying Loan and Fixed Return create flows

**What to build:** Create offers two position types with board-accurate stage collapse. Grammar is SOURCE → UNDERLYING → AMOUNT → TERM → OUTCOME → REVIEW. REVIEW always appears. Fixed Return is OVRFLOLending supply of ovrfloToken at a selected APR tick, not a loan outcome. Equivalent Default and Advanced choices produce the same typed primitive or graph intent before calldata. USD and UI-only stage state stay outside canonical actions.

**Blocked by:** 11, 15

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/16-position-type-flows.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not implement composite resume
(17), Hosted Convert, or USD execution (18). Do not invent request-book UI (19).
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD16 stage grammar and Fixed
Returns, KD17 first four paragraphs (typed intent and graph ID allocation only —
resume persistence is 17), AS2, AS4, AS5, ### CS4-U3, and Verification Contract
successors *Position types*, *Conditional stages*, *Fixed-source amount*,
*Fixed return supply*, *Product-mode parity*, *Default disclosure*.
Map ownership: BORROW owns Self-Repaying Loans; SUPPLY owns Fixed Returns;
REVIEW owns review. parseAction stays compatibility-only.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `DESIGN.md`
- `PRODUCT.md`
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Self-Repaying Loans and Fixed Returns appear as separate position types
- [ ] Fixed Return is absent from Self-Repaying Loan OUTCOME choices
- [ ] A fixed eligible existing stream skips AMOUNT; fresh capital with a selectable value shows AMOUNT
- [ ] REVIEW appears for every valid flow, including an all-fixed direct route
- [ ] Zero supported underlyings, zero valid terms, or zero valid outcomes shows a named blocking state
- [ ] TERM stays hidden for one valid term and appears for multiple valid terms
- [ ] OUTCOME stays hidden for one valid outcome and appears for multiple outcomes within the selected type
- [ ] Changing an upstream choice preserves only valid dependents, clears invalid ones, and moves to the first newly required or blocking stage
- [ ] Default DOM contains no APY, protocol, router, PT, market, or route labels
- [ ] Advanced may expose supported protocol bindings and compiles the same typed supply or borrow intent as Default
- [ ] A canonical action contains no USD or UI-stage field
- [ ] A Fixed Return submits ovrfloToken supply at the selected APR tick; unmatched supply is Waiting and withdrawable without a promised return
- [ ] Matched Fixed Return return/date values render only after authoritative reads establish both
- [ ] A partially filled Fixed Return that matched across multiple loans shows exact per-loan amounts and dates under a Multiple completion dates summary; the unfilled suffix stays Waiting and withdrawable
- [ ] Desktop renders one active decision plus completed-choice summary; mobile renders one decision surface
- [ ] Route/stage transitions and Back satisfy the heading/opener focus contract

## Plan unit

CS4-U3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
