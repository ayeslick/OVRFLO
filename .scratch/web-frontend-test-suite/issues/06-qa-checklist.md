# 06 — Minimal QA checklist

**What to build:** One short document for the handful of things E2E structurally cannot verify.

**Blocked by:** None strictly — needs Ticket 05's *scope* defined (which journeys, error states, and cross-cutting properties exist, i.e. R10-R12), not its scenarios fully implemented and passing. Can be drafted in parallel with Ticket 05.

**Status:** done

- [x] New `web/tests/e2e/qa-checklist.md`
- [x] Covers pixel-level DESIGN.md compliance only (grid lines, no drop shadows, sharp corners) — this requires visual judgment, not an automatable assertion
- [x] Does **not** include responsive breakpoints — that check moved to an automated Playwright scenario in Ticket 05 (`supply.feature`, via `page.setViewportSize()`)
- [x] Not a code gate; references DESIGN.md compliance items only

See plan Unit U6 (R13) in `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`.

## Comments

Wrote `web/tests/e2e/qa-checklist.md` as a manual walkthrough checklist, organized by
`DESIGN.md` section (§1 canvas/structure, §6 color semantics, §3 typography, §4/5/9
component/modal rules, §8 forms, §11 motion, §10 data formatting). Every item is something
that genuinely requires eyeballing the rendered app rather than a DOM/computed-style
assertion (shadow presence, corner sharpness, color *intent* rather than raw hex, transition
smoothness) — the boundary the ticket asked for. An explicit "Out of scope" section at the
bottom cross-references `supply.feature`'s `page.setViewportSize()` scenario (responsive) and
the rest of `tests/e2e/*.feature` (journeys/errors), so nothing gets silently duplicated
between the manual and automated layers. Front-matter of the doc itself states plainly it is
not a code gate, per the ticket's own requirement.

This closes out the last ticket in `web-frontend-test-suite`; Ticket 05 remains the only one
flagged `ready-for-human` (the `bootstrap:local` / `PRIMARY_EXPIRY` fixture-staleness blocker
documented there).
