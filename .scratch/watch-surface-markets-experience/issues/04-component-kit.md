# 04 — Component kit

**What to build:** The shared vocabulary all surfaces compose from — built once, accessibility inside the component, every state renderable from fixtures. Ribbons, rolling numbers, lens tabs, rate window, receipts, and related kit pieces exist without wiring real chain data.

**Blocked by:** 02 — Charter + region briefs; 03 — State-key catalog + standards

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/04-component-kit.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not start flow routes or hooks. Do not add runtime dependencies.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Design System Pins, KTD6, KTD7, KTD11, KTD12, ### U4, WIG/ethskills spot gates.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Design System Pins, KTD6–KTD7, KTD11–KTD12, ### U4, Verification Contract WIG/ethskills gates
- Region briefs and both standards from tickets 02–03
- Approved walkthrough (visual authority for ribbon/hero idiom)
- this ticket's acceptance criteria

- [x] Kit components exist for shell, lens tabs, entity row, ribbon, capital band, rolling number, settlement trace, receipt, rate window, queue band, amount field, token/USD switch, amount, disclosure, action button, status line, address chip
- [x] Each component renders every declared state from fixture props; kit tests assert labels, roles, and state classes
- [x] Ribbon/capital band are hand-drawn canvas with a fixed point budget; reduced-motion stops decorative rAF while numeric text keeps updating
- [x] Rolling number is `role="timer"` in a fixed-width `tabular-nums` container (no layout shift across ticks)
- [x] Lens tabs follow APG tablist (roving tabindex, arrows, Home/End, automatic activation)
- [x] Rate-window paddles are labeled buttons; disabled-with-reason at ladder bounds
- [x] Action button requires a reason when disabled; receipts are token-exact
- [x] Resting entity row renders zero animated nodes; status line covers SYNCED/RECONNECTING/DEGRADED; USD unavailable disables the switch
- [x] Fixture route (local runtime profile only) renders all states at 1280px and 360px
- [x] Design-detector hook is clean on kit files; kit tests green

## Plan unit

U4 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
