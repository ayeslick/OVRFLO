# 15 — Portfolio hub, collection, and detail routing

**What to build:** Your OVRFLO shows only the surface justified by a complete bounded scan and full hydration. Partial or retrying discovery stays on an incomplete Your OVRFLO state and preserves confirmed cards. After complete hydration on `/`: zero positions → empty plus Create at `/create/`; one position → detail URL; multiple same type → that collection URL; mixed types → hub with no type or identity query. Waiting and completed positions remain reachable. Unlike token symbols are never summed. Activity lists at `/activity/` and does not use the portfolio matrix.

**Blocked by:** 11

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/15-portfolio-routing.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not build create flows (16).
Do not wait for CS5-U2; the router must remain correct without optional enrichment.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD16 portfolio routing, KD16
destination URL table, AS3, AS10, ### CS4-U2, Verification Contract successors
*Portfolio routing* and *Destination URLs*, and map ownership (WATCH owns
portfolio and activity).
Log-derived candidates are display data. Action-critical facts are re-read
directly from chain before any wallet prompt.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `DESIGN.md`
- `PRODUCT.md`
- `docs/maps/SCHEMAS.md` §2 and §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] A partial scan or failed hydration remains on incomplete Your OVRFLO, preserves confirmed cards, and never routes from its provisional count
- [ ] Zero positions routes to the single empty state and Create at `/create/` only after the bounded scan completes
- [ ] One Self-Repaying Loan routes directly to loan detail
- [ ] One Fixed Return supply routes directly to fixed-return detail
- [ ] Multiple Self-Repaying Loans and no other type route directly to the loan collection
- [ ] Multiple Fixed Return supplies and no other type route directly to the fixed-return collection
- [ ] Mixed types route to the hub with one collection card per type
- [ ] Waiting and completed positions remain reachable and retain their meaningful status
- [ ] Collection sorting changes row order without changing hydrated counts or hiding completed/waiting entries
- [ ] Different token symbols are never summed; same-underlying groups retain exact totals
- [ ] Activity is newest-first and chain-confirmed; partial history says incomplete; wallet rejection is not an activity row
- [ ] After complete hydration, `/` with one loan writes `?lending=` and `?loan=`; one Fixed Return writes `?lending=` and `?position=`; multiple same-type writes `?type=`; mixed hub writes neither type nor identity
- [ ] A stale `?loan=` or `?position=` for an unowned entity is stripped and the matrix applies
- [ ] Incomplete scan on `/` does not add `?type=` or identity params from a provisional count
- [ ] `/activity/` lists activity and does not apply the portfolio matrix
- [ ] Watch E2E covers the zero/one/same-type/mixed-type matrix

## Plan unit

CS4-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
