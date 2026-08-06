# 07 — Amount input accessibility & correctness

**Category:** bug (accessibility + correctness)

**Covers:** R14, R21, R22, R24 (Tranche 4). Findings: M-1, M-12, M-14, L-11.

**What to build:** Every amount input across every form is accessible (labelled, decimal-mode, exposes validation state), never overstates what the user holds, and gates on a live clock rather than a value frozen at mount.

**Details:**
- R14/M-1: every amount input carries a programmatic label, `inputmode="decimal"` (or equivalent), and validation state exposed to assistive technology.
- R21/M-14: balance and maturity displays never overstate what the user holds and never round up.
- R22/L-11: maturity gates re-evaluate against a live clock in every form. Today `useNowSeconds(true)` (30s tick) is used only by `SupplyForm`; `ConvertForm`, `BorrowForm`, `AdjustRateForm`, `MarketRowDetail`, and `PositionList` capture the clock once at mount, so a market crossing maturity while a panel is open leaves DEPOSIT/BORROW/ADJUST enabled until remount. Wire the same live-clock hook into all five.
- R24/M-12: amount inputs expose a MAX control and a balance line consistently across all call sites.

**Acceptance criteria:**
- [x] Every amount input (deposit, wrap/unwrap, borrow, supply, adjust rate, repay) has a programmatic label, decimal input mode, and exposed validation state
- [x] Balance/maturity displays round down, never up
- [x] `ConvertForm`, `BorrowForm`, `AdjustRateForm`, `MarketRowDetail`, `PositionList` all use the live-clock hook for maturity gating, matching `SupplyForm`'s existing behavior
- [x] MAX control + balance line present and consistent on every amount input
- [x] Existing test suite green; no visual regression on the markets console

**Out of scope:**
- Ladder/modal keyboard and focus accessibility (ticket 08)
- Touch target sizing and color contrast (ticket 09)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4, gate: existing suite green, automated accessibility pass clean, no visual regression).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Grouped by theme (amount-input correctness) rather than by finding ID — all four requirements touch the same handful of form components.

**2026-07-29 (implemented):** Landed as U7 on branch `fix/audit-2026-07-28-tranche-1`.

L-11 was exactly as the audit described: `useNowSeconds(true)` was used only by SupplyForm, so five components captured the clock once at mount and left DEPOSIT/BORROW/ADJUST armed on a market that had crossed maturity while the panel sat open. All five now tick.

R14 and R24 came out as one shared `AmountInput` primitive rather than four patched call sites. The four amount fields were bare `<input>` elements: no programmatic label (the placeholder is not one), no decimal input mode, and a validation state carried only by a CSS class — invisible to assistive technology. The primitive owns the label/field/balance/error group, associates the error via `aria-describedby`, and sets `aria-invalid`. A fifth form inherits all of it.

One deliberate asymmetry: BorrowForm gets the label and decimal mode but no balance line or MAX. A borrow is bounded by posted ladder depth, not by anything in the borrower's wallet, so a wallet balance there would describe the wrong constraint. RepayForm's MAX keeps its own bound (`repayMax`, capped by the outstanding obligation) via `maxDisabled` rather than the default zero-balance rule.

Follow-on from U3 worth noting: the "every enabled control is CLOSE" assertion had to widen to "CLOSE or MAX". MAX only fills the field and signs nothing, so the original assertion was over-broad rather than the new behaviour being wrong.

Coverage: 14 new cases — labelling and decimal mode across all five amount-bearing forms, programmatic validation state with an associated error message, balance line and MAX behaviour, the borrow asymmetry, and the zero-balance MAX guard. Full suite 376 passed; lint, `tsc --noEmit`, and `npm --prefix web run a11y` all clean.

**2026-07-29 (E2E follow-up):** The L-10 maturity change broke the E2E row locator and the unit suite could not have caught it. `readSecondaryMaturityLabel()` in `web/tests/e2e/fixtures/chain.ts` built the markets-row locator from `formatMaturity`, while `MarketsTable` renders `formatMaturityDate` — so once the caption form gained its "Matures " prefix the two diverged, `hasText` missed, and all nine expand-dependent scenarios timed out at 30s each. Fixture realigned to the function the table actually renders.

Also dropped the caption form itself. No surface renders maturity as prose today, so shipping `formatMaturity` would have left an exported function with no call site — dead code of exactly the kind R30 asks us to remove. `formatMaturityDate` and `formatMaturityId` both have consumers and stay; the caption form should be added back with its first real caller.
