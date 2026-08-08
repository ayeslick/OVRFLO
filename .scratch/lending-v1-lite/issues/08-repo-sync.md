# 08 — Repo sync

**What to build:** Bring every contract-describing surface in line with the shipped design so future reviews read true. Mechanical accuracy pass, not prose rewrites: `README.md` (OVRFLOLending section, function table, flows), `x-ray/entry-points.md` and `x-ray/invariants.md` (the frozen-history property stated precisely enough to hand to formal verification), `CONCEPTS.md` (promote the v1-lite vocabulary out of "planned"; mark superseded LiquidityPosition/Listing/Pool entries — do not delete), `PROPERTIES.md` and `AUDIT.md` pointer notes, `docs/solutions/patterns/ovrflo-critical-patterns.md` (#4/#10/#16 annotated superseded-by-design with the plan's justifications), the stale PRB-Math dependency mention corrected, and `script/OVRFLO.s.sol` + `script/seed-local.sh` gaining the tick-spacing onboarding step (preserving the `forge create`/`cast send` pattern — never `forge script --broadcast` locally). The web app is explicitly untouched.

**Blocked by:** 06, 07

**Status:** open
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U8 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/08-repo-sync.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not touch web/.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Planning Contract (KTD12; Pinned Conventions), Definition of Done, and ### U8.
Smoke-verify the seed path end-to-end on a local Anvil mainnet fork
(bash script/seed-local.sh); if MAINNET_RPC_URL is unavailable, record an
environment-gate result rather than a product regression.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rule 2 — the Anvil broadcast pitfall this ticket must not reintroduce)
- `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`
- `docs/agents/testing.md`
- the plan's Definition of Done (this ticket closes most of it)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] README OVRFLOLending section, function table, and user flows match the shipped ABI (supply/withdraw/borrow/repay/close/claim + advanceEpochCursor + views)
- [ ] `x-ray/entry-points.md` and `x-ray/invariants.md` updated; frozen-history lemma stated formally (Success Criteria's FV-handoff bar), with the U6 invariant named as its executable form
- [ ] `CONCEPTS.md`: v1-lite section promoted to current; superseded entries marked with pointers, not deleted
- [ ] `ovrflo-critical-patterns.md`: #4/#10/#16 annotated superseded-by-design with the plan's recorded justifications; PRB-Math dependency mention corrected in root docs
- [ ] `script/OVRFLO.s.sol` and `script/seed-local.sh`: tick-spacing onboarding step added; `forge create`/`cast send` pattern preserved; seed smoke passes on an Anvil mainnet fork (or environment gate recorded)
- [ ] Grep for `createBorrowerLoanPool|claimLoanPoolShare|postSaleListing|LiquidityPosition` returns hits only in historical docs (`docs/plans/`, `docs/audit/`, `docs/solutions/`, `docs/research/`)
- [ ] Carried-over require-strings in `src/OVRFLOLending.sol` (eleven sites flagged in the 2026-08-08 U3 review) converted to catalog custom errors, or each recorded as intentionally retained with rationale (KTD3 reconciliation)
- [ ] Definition of Done sweep: no dead code in `src/`; every AE1–AE9 has an enforcing test carrying its `Covers AE<N>.` prefix; Product Contract preservation note still accurate

## Plan unit

U8 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
