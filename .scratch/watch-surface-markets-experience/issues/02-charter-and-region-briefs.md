# 02 — Charter + region briefs

**What to build:** `docs/maps/` describes the new topology completely: eight regions, every screen and interaction of the render inventory under a seven-field control contract, before any flow unit starts. An implementing agent can look up what a control means and what it must not claim.

**Blocked by:** 01 — Foundation: ABI, tokens, fonts, purge

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/02-charter-and-region-briefs.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not start other units. Do not invent health-factor or liquidation product behavior. Do not write flow code.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Product Contract (R1–R14 and Key Decisions), KTD2, KTD3, ### U2.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Product Contract, KTD2–KTD3, ### U2
- `docs/maps/SCHEMAS.md`, `docs/maps/README.md`, `docs/maps/REVIEW.md`, `docs/adr/README.md`
- `PRODUCT.md`, `CONCEPTS.md`
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` (read-only; entry model superseded by this plan)
- this ticket's acceptance criteria

- [x] Eight region briefs exist: SHELL, WATCH, BORROW, SUPPLY, RATES, REVIEW, ASSETS, FIRST-RUN
- [x] Every control carries the seven fields with IDs `UI-<REGION>-<CONTROL>`
- [x] Coverage table maps all 24 flow-spec renders plus this plan's additions (lens renders, ribbon states, degraded, first-run, risk, both claim-confirmed variants) with zero gaps
- [x] Watch brief carries lens memory, URL-reflected select, ribbon state enumeration, hero tick semantics, and action visibility; only vault-created streams render under Streams
- [x] Shell brief owns disconnected entry copy reframed to the watch-surface model
- [x] SETTLEMENT trace and PERMISSION/ACTION receipts are documented once in REVIEW as shared families
- [x] Copy follows OVRFLO voice and the market-driven-symbol rule
- [x] ADR records the region-set replacement and Owner approval (2026-08-11) with the five required sections
- [x] U1 temporary maps-presence exemptions are removed; `lint:maps` is green
- [x] `ce-doc-review` passes on the brief set

## Plan unit

U2 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
