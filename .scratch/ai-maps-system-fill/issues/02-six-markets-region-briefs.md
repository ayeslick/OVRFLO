# 02 — Six Markets region briefs

**What to build:** Each of the six Markets Operate regions has a filled brief with nested controls using the seven mandatory fields (ID, Purpose, Visible when, States, Action, Copy rules, Data authority). An implementing agent can look up what a control means and what it must not claim — without inventing product behavior. Optional a11y/color/test-link columns may be omitted.

**Blocked by:** 01 — Maps operating charter

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/02-six-markets-region-briefs.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not start other units. Do not invent health-factor or liquidation product behavior.
Before any writes, read Required reading below and the plan sections: Goal Capsule, ### U2, SCHEMAS (via docs/maps after ticket 01), Product Contract D2–D3.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- `docs/maps/SCHEMAS.md` and `docs/maps/ui/README.md` (from ticket 01)
- `PRODUCT.md`
- Incumbent Markets shell behavior (read enough of MarketsApp / positions strip / table / expand / modal / system states to inventory controls — do not redesign UI)
- `docs/plans/ux-personas-journeys-screens.md` locked decisions (where still accurate)
- this ticket's acceptance criteria

- [x] Six region briefs exist covering: Header; YOUR POSITIONS; SELF-REPAYING MARKETS table; Expanded settlement; Action modal/overlay; System chrome
- [x] Every region has ≥1 nested control with all seven mandatory fields
- [x] Stable control IDs are assigned — using the **normative** `UI-<REGION>-<CONTROL>` format from `docs/maps/SCHEMAS.md` §1, not the `header.lockup` / `strip.claim-all` examples above (those were illustrative and predate SCHEMAS.md)
- [x] System chrome documents distinct loading / empty / error / truncated / disconnected behaviors
- [x] Expanded settlement treats SUPPLY and BORROW as equal peer actions
- [x] Copy rules forbid shipping generative product framing (including health-factor / liquidation as product truth)
- [x] UI index links all six briefs

## Plan unit

U2 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
