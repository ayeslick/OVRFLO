# 17 — Composite recovery runtime

**What to build:** Default and Advanced share one mode-neutral action graph with stable graph ID, semantic step IDs, ordered dependencies, and per-step rebuild. Confirmed-step receipts persist in throw-tolerant storage. Resume starts at the first unconfirmed step and never replays a confirmed step. Unknown outcome is distinct from recoverable. Clear-to-zero and set-allowance are separate authorization steps. Deposit continuation decodes `Deposited.streamId`. Borrow rebuild uses real routed depth, eligibility, and current router/request state. Without CS3, no-liquidity deposit-plus-borrow blocks before deposit. This ticket does not implement Hosted Convert or execution-grade USD.

**Blocked by:** 16

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U4 recovery only (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/17-composite-recovery.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not implement Hosted Convert,
CSP origin, or the USD resolver (18). Do not implement request-book UI (19).
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD17 recovery / graph-ID /
unknown-outcome / confirmed-step transfer paragraphs, composite recovery
state diagram, AS5, AS6 no-liquidity sentence, AS9, ### CS4-U4 approach bullets
that are not hosted/USD, and Verification Contract successors *Composite resume*,
*Authorization sequence*, *Deposit output decode*, *Immediate-total honesty*,
*Finality*, *Unknown-outcome resolution*, *Post-submit throw reconciliation*,
*Modal close keeps the attempt*, *Reset is resume*.
Generalize the existing transaction queue. Do not add a second composite executor.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Deposit confirms and borrow is rejected: resume revalidates borrow only and does not replay deposit
- [ ] A confirmed step followed by account, chain, allowance, liquidity, deadline, or router change blocks or rebuilds only the pending step
- [ ] A first-mined receipt is pending; a confirmed hash with a failed receipt is not complete; confirmations equal `RECEIPT_CONFIRMATIONS` (currently 2)
- [ ] Default recovery copy identifies completed and remaining user outcomes without protocol or approval mechanics
- [ ] Clear-to-zero and set-allowance keep distinct stable step IDs; each next prompt follows receipt persistence, wallet reacquisition, rebuild, and simulation
- [ ] Receipt storage keys include factory, chain, account, graph ID, and step ID; throwing storage does not erase runtime progress
- [ ] Missing or ambiguous `Deposited.streamId` blocks the borrow continuation
- [ ] Borrow rebuild uses real routed depth, authoritative eligibility, and current router/request reads — no placeholders
- [ ] Without CS3, no-liquidity deposit-plus-borrow blocks before deposit; with immediate executable borrow, the composition may proceed
- [ ] Completion, settlement, close, and repayment labels require both finality and a fresh authoritative state read
- [ ] A wallet submit that returns unconfirmed persists the pending hash and step identity; resume reconciles that hash before rebuild or prompt; submission stays suppressed while the outcome is unresolved
- [ ] Transfer-with-reallocation: a new attempt allocates a fresh graph ID; resume keys only on that ID; prior confirmed-step evidence stays read-only audit evidence
- [ ] Confirmed-step status transfers across graph-ID reallocation by economic identity; resume never double-prompts an economically identical confirmed step
- [ ] Closing the modal unmounts the body and keeps the pending plan and graph ID; a reopened body resumes or reallocates and never auto-confirms a latched plan the user did not accept
- [ ] Route-level error reset, modal TRY AGAIN remount, and flow unmount cleanup converge on the same resume contract
- [ ] Risk acknowledgment gate (KD17 owner pin 2026-09-01): `RISK_DISCLOSURE_VERSION` in the policy module; key `ovrflo:ack:<chainId>:<factory>:<account>:<version>`; shown after position-type selection and before the first wallet prompt; never on hub, collection, or detail; older version or other factory re-requires it; `Advanced` shares it; Fixed Return path adds the matched-capital sentence; `VIEW FULL RISKS` links to `/risk/`

## Plan unit

CS4-U4 recovery slice in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
