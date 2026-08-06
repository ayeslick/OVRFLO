# 09 — Touch targets, contrast & mobile layout

**Category:** bug (accessibility + visual)

**Covers:** R17, R18, R23 (Tranche 4). Findings: M-16, M-10.

**What to build:** Every interactive target meets the minimum touch size, text and state colors meet WCAG AA contrast (including settled/dimmed cards), and position cards render without horizontal overflow at mobile widths.

**Details:**
- R17/M-16: every interactive target meets 24×24 CSS pixels minimum.
- R18/M-10: text and state colors meet WCAG AA contrast, including cards rendered in a settled or dimmed state — this is the specific gap the audit flagged (dimmed/settled states are where contrast tends to fail even when the default state passes).
- R23: position cards render without horizontal overflow at mobile widths.

**Acceptance criteria:**
- [x] All interactive targets audited and brought to ≥24×24px where under
- [x] Automated contrast check passes for default, settled, and dimmed card states
- [x] Position cards verified at mobile viewport widths with no horizontal overflow (manual or automated viewport test)
- [x] Automated accessibility pass clean; no visual regression on the markets console at desktop widths

**Out of scope:**
- Amount input and ladder/modal accessibility (tickets 07, 08)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Grouped as "does the UI physically work at the sizes/colors it's rendered at" — distinct from the input/keyboard-behavior tickets.

**2026-07-29 (implemented):** Landed as U9 on branch `fix/audit-2026-07-28-tranche-1`.

*Contrast (M-10).* `.card-dimmed { opacity: 0.5 }` composited the whole subtree against the card background, dropping `.label` text to roughly 2.1:1 against a 4.5:1 requirement. A settled card is not a disabled control, so it gets no contrast exemption. Replaced the opacity compositing with explicit dimmed colours so each element clears AA on its own while the visual step down survives.

*Target size (M-16).* `.row-toggle` and `.advanced-toggle` both had `padding: 0`, computing to roughly 19px and 14px against WCAG 2.2 AA's 24×24 minimum — and `.advanced-toggle` gates the only route to WRAP and to REPAY EARLY. Both padded to a 24px floor. `.modal-close` computed to about 26×26, a pass that would break on any font-size change, so its minimum is pinned rather than left to drift.

*Mobile overflow (M-11).* Structural, not cosmetic. The expanded detail rendered as a `<tr>` inside the markets table, so it inherited `table { min-width: 760px }` and every position card, balance row, and action button sat in a 760px layout box — overflowing horizontally on mobile, against DESIGN.md §5's "cards render at every breakpoint, not a reflow". It now renders as a sibling below the table, detached from that floor. Clipping the overflow would have hidden the symptom while leaving the cards unreadable.

*I-4 and I-5.* `100vh` (and the modal's `90vh`) ignore the mobile browser's collapsing toolbar, so the container ran taller than the visible viewport; `dvh` added with `vh` retained as the fallback. Added the missing intermediate breakpoint at 860px, where the layout previously jumped straight from the mobile stack to the full desktop grid and crowded the action buttons onto one line.

Coverage: 3 new cases pinning the structural fix — the detail region has no `table` ancestor (the assertion that actually encodes M-11), collapse still works, and switching markets swaps rather than showing both. The contrast, target-size, and viewport changes are CSS-only, verified by the a11y sweep and by inspection against the audit's measured values; this repo has no computed-style or visual-regression harness to pin them harder. Full suite 400 passed; lint, `tsc --noEmit`, and the a11y sweep clean.
