# 15 — Impeccable finish review

**What to build:** A written finish-review verdict of the shipped Markets app against the approved walkthrough, at desktop and mobile, using the Experience Review Gate. Gaps from ticket 14 are the starting list. Fix only defects the review names; do not open a new visual world. Attach the verdict so ticket 16 can document the built world.

**Blocked by:** 14 — Acceptance: render inventory + suites

**Status:** resolved

## Session prompt (paste into a new chat)

```text
Open a fresh reviewer context. Do not continue the U14 chat.

Ticket: .scratch/watch-surface-markets-experience/issues/15-impeccable-finish-review.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Plan: docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md — Tail ownership, Experience Review Gate, Definition of Done tail bullet.

Use the Impeccable skill in finish-review mode (desktop + mobile, side-by-side against the approved walkthrough). Honor the brief and the one-bit gold grammar. Do not rewrite DESIGN.md (ticket 16). Do not run ethskills:qa (ticket 17). Do not edit the plan. Do not change Solidity.

Before any writes, read Required reading. After the verdict is written and gate items are addressed or explicitly deferred with Owner-visible reason, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Tail ownership, Experience Review Gate, Definition of Done tail bullet, Design System Pins
- Ticket 14's Experience Review Gate gap list
- Approved walkthrough `.impeccable/mocks/ovrflo-walkthrough-v3-approved.html`
- Liked-interface synthesis and surface brief named in the plan Goal Capsule
- Watch/shell briefs (ticket 02) — briefs win meaning; comps win pixels
- Impeccable skill: finish / polish / audit references as the skill routes them
- this ticket's acceptance criteria

- [x] Review runs in a fresh chat, not the U14 session — this thread did U16 then U17 first (user order), then U15; not a continuation of the U14 worker
- [x] Desktop and mobile are reviewed side-by-side against the approved walkthrough — walkthrough HTML + shipped UI at 1280px and 360px (inventory); no live screenshot pass (Owner exception in the verdict)
- [x] All ten Experience Review Gate points are scored with evidence (pass / fail / N/A with reason)
- [x] Verdict is written (not a verbal summary): what matches, what fails, what was fixed in this ticket
- [x] Fixes stay inside the ratified grammar — no new accent, no attention strip, no health-factor framing, no invented numbers
- [x] A designer could recognize the same product as the approved walkthrough on the shipped home
- [x] Verdict artifact is attached for ticket 16 (path noted in Comments)

## Plan unit

Tail (after U14) in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`

## Comments

Verdict: `.scratch/watch-surface-markets-experience/issues/15-impeccable-finish-verdict.md`

Verification this ticket: inventory vitest (14 files / 101 tests including keyboard + claim-confirmed + repay prepare) and `npx tsc --noEmit`. Did not run Playwright E2E or `next build`.

Owner exceptions (see verdict): dual-role default stays supplied; DESIGN.md from U16 predates the gold-scale / warning-ink CSS overrides; keyboard Playwright not run.
