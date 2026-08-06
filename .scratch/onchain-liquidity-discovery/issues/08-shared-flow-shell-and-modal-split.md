# 08 — Shared flow shell and incremental modal split

**What to build:** After policy and executor ownership have moved out, introduce a shared review/progress/terminal/recovery shell and incrementally extract actions into flow components (Borrow last), preserving current OVRFLO visual design, dialog container, focus/Escape/inert behavior, labels, body-only error recovery, and polite milestone announcements. Depth/routing/hydration explanations appear without coupling presentation to the scanner.

**Blocked by:** 06 — Single-action transaction executor; 07 — Claim All through the executor.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U8 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/08-shared-flow-shell-and-modal-split.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U8.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- plan KTD10, KTD15 (modal/a11y)
- this ticket's acceptance criteria


- [x] Shared shell covers review, progress, terminal, and recovery for extracted flows
- [x] Live dialog keeps title, close, focus entry/containment, Escape, inert background, and focus restoration
- [x] Body render errors leave header and close usable
- [x] Borrow explains preparing, partial, unavailable, stale-route, fragmented, insufficient, and true-zero states for sighted and screen-reader users without per-range announcement flood
- [x] Portfolio unload/recovery and Claim All preflight fit the existing dialog/a11y contract on narrow layouts
- [x] Extracted flows retain previous amounts, summaries, limits, and action-specific behavior
- [x] Action modal becomes composition; discovery implementation stays outside presentation

## Plan unit

U8 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
