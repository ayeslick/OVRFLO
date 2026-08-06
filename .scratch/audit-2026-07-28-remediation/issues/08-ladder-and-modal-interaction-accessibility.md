# 08 — Ladder & modal interaction accessibility

**Category:** bug (accessibility)

**Covers:** R15, R16, R19, R20 (Tranche 4). Findings: M-4, M-5, L-5, M-13.

**What to build:** The rate ladder is fully keyboard-operable consistent with its radiogroup role, modal focus is trapped and deterministic, the focus indicator is strengthened, and motion follows the design spec including reduced-motion.

**Details:**
- R15/M-4: rate ladder exposes a keyboard model consistent with its radiogroup role (arrow-key navigation between rate options, not just tab-and-click).
- R16/M-5: modal focus is trapped for the modal's lifetime and initial focus is deterministic (lands on a specific, sensible element every time the modal opens, not wherever it happened to be).
- R19/L-5: focus indicator is strengthened within the design spec's no-glow constraint — do not weaken to a border shift alone; find a stronger treatment DESIGN.md's constraints allow.
- R20/M-13: motion follows the design spec and respects `prefers-reduced-motion`.

**Acceptance criteria:**
- [x] Rate ladder is operable with arrow keys per radiogroup convention, verified with a keyboard-only test
- [x] Every modal traps focus for its lifetime; initial focus is deterministic and asserted in a test
- [x] Focus indicator visibly strengthened while staying within DESIGN.md's no-glow constraint
- [x] All motion respects `prefers-reduced-motion`; verified against DESIGN.md's motion spec
- [x] Automated accessibility pass clean; no visual regression on the markets console

**Out of scope:**
- Amount input labelling (ticket 07)
- Touch target size and contrast (ticket 09)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. All four requirements are keyboard/focus/motion interaction concerns on the ladder and modal components specifically.

**2026-07-29 (implemented):** Landed as U8 on branch `fix/audit-2026-07-28-tranche-1`.

*Ladder (M-4).* The group already carried `role="radiogroup"` with `role="radio"` children but behaved like a row of plain buttons — every option sat in the tab order and arrows did nothing, so keyboard users had to Tab through every rate to reach the control after the ladder. Now a single tab stop with roving `tabindex`, arrow/Home/End navigation that wraps, and focus moving with selection (the pattern expects each option to be announced as arrowing chooses it). The tab stop falls on the first option when nothing is selected, so the group is always reachable.

*Focus trap (M-5).* Both defects the audit named were real. The keydown listener was bound to the container, so it went deaf the moment focus left the panel — which happens constantly here as buttons swap between APPROVE/SUPPLY/CLOSE and an element is removed while focused. It listens on `document` now and reels focus back when it has escaped. Initial focus was contested between the hook's `focusable[0]` call and `MarketDetail`'s own effect on the same commit; `useFocusTrap` takes an `initialFocus` selector so the caller has one explicit say, falling back to the first focusable element for forms that render no input.

*Focus indicator (L-5).* `.input:focus` was `outline: none` plus a border-colour change — a border shift alone, which R19 explicitly forbids — and buttons and ladder rows had no focus styling at all. Thickened to a 2px border per the audit's own recommendation, which strengthens the edge without the glow DESIGN.md rules out. Padding drops by the extra border width so focusing never nudges layout, and `:focus-visible` keeps the treatment off pointer clicks.

*Motion (M-13).* There was no reduced-motion path at all. Added one covering animation, transition, and scroll-behaviour. Durations collapse to `0.01ms` rather than `none` so `animationend`/`transitionend` listeners still fire — killing motion outright can hang anything waiting on those events.

Verification note: the ladder and focus-trap changes carry unit tests. The focus-indicator and reduced-motion changes are CSS-only — they are verified by inspection against DESIGN.md §10's no-glow constraint and by the a11y sweep passing, not by an assertion. A visual-regression or computed-style test would pin them harder; neither exists in this repo today.

Coverage: 18 new cases across two new files — `tests/components/ladder-keyboard.test.tsx` (10) and `tests/hooks/useFocusTrap.test.tsx` (8), the latter including the escaped-focus case that the old container-bound listener could not have passed. Full suite 397 passed; lint, `tsc --noEmit`, and the a11y sweep clean.
