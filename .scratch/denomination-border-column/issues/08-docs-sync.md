# 08 — Docs sync and README two-line fix

**What to build:** Docs describe the nested column and ovrfloToken denomination. CS0's two README line fixes ship here. Architecture, concepts, onboarding, security, product operating context, critical patterns, rejected-finding pointers, and x-ray match the shipped CS1 surface. This ticket does not rewrite CS4 product UX.

**Blocked by:** 06, 07

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS1 U8 plus CS0 only (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/08-docs-sync.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not change Solidity or web
behavior. Maps wrap-reserve retarget belongs to 07 — verify it is present, do not
relitigate it.
Before any edits, read Required reading below and the plan sections: KD15, KD13
doc consequences, ### CS0, ### CS1 U8, and Definition of Done CS1.
CS0 greps: README lending.getfoundry.sh → book.getfoundry.sh; roadmap sentence
"Built after the Lending establishes a market APR" → "Built after the lending
market establishes an APR". No other CS0 content change.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/agents/onboarding.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- `docs/audit/rejected-findings-record.md` (R-02 pointer follows the sweep to the reserve)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] `README.md` uses `book.getfoundry.sh`, not `lending.getfoundry.sh`
- [ ] `README.md` roadmap line is "Built after the lending market establishes an APR"
- [ ] README architecture sections describe `OVRFLOReserve`, two named minters, ovrfloToken lending escrow, and nested deploy
- [ ] `CONCEPTS.md` has an `OVRFLOReserve` entry, three labeled exits, and denomination vocabulary
- [ ] `docs/agents/onboarding.md` §2/§4/§5/§7 combined solvency and live map match KD13. Do not restore an Architecture Overview into `AGENTS.md`; that file stays the session router.
- [ ] Critical patterns fee denomination and sweep-reserve reasoning move to the reserve
- [ ] `VAULT_SECURITY.md` records two burn authorities
- [ ] `PRODUCT.md` Operating Context: lender-supply and borrower-proceeds references are ovrfloToken; `underlying` stays column identity
- [ ] R-02 rejected-finding pointer follows the sweep to the reserve
- [ ] `x-ray/` refresh matches the post-CS1 contracts
- [ ] Grep for PT flash as a live vault facility returns hits only in historical plans, audits, or this ticket's "removed" wording

## Plan unit

CS0 and CS1 U8 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
