# 16 — DESIGN.md from shipped UI

**What to build:** `DESIGN.md` rewritten by the Impeccable documenter from the built world after ticket 15's finish review. Never pre-written from mocks. An agent opening the repo later can recover the visual system from the shipped UI, not from the walkthrough HTML.

**Blocked by:** 15 — Impeccable finish review

**Status:** resolved

## Session prompt (paste into a new chat)

```text
Open a fresh documenter context. Do not continue the ticket 15 chat.

Ticket: .scratch/watch-surface-markets-experience/issues/16-design-md-from-shipped-ui.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Plan: docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md — Tail ownership (Impeccable documenter rewrites DESIGN.md from the shipped UI, never pre-written).

Use the Impeccable `document` command against the built Markets app. Source of truth is the shipped UI after ticket 15, not the walkthrough file. Do not re-open finish review. Do not run ethskills:qa (ticket 17). Do not edit the plan. Do not change product behavior.

Before any writes, read Required reading. After DESIGN.md matches the built world, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan Tail ownership, Design System Pins, Definition of Done tail bullet
- Ticket 15 verdict artifact
- Shipped UI (built app / current `web/` surfaces), not the mock as the document source
- Impeccable `document` reference
- Incumbent `DESIGN.md` only as something to replace, not to merge with
- this ticket's acceptance criteria

- [x] Review runs in a fresh chat after ticket 15 is resolved — **exception:** Owner sequenced U16 then U17 in this session without U15. Documenter did not re-open finish review.
- [x] `DESIGN.md` is generated from the shipped UI (`document`), not authored from mocks or the plan
- [x] Tokens, type, accent (single gold), motion, and layout rules match what shipped — including what ticket 15 fixed. Ticket 15 did not run; gold-on-paper RollingNumber / `.status-warning` are recorded as shipped exceptions.
- [x] Document does not reintroduce retired cyan, Inter, NOW/NEXT, or health-factor language
- [x] Briefs remain meaning authority; DESIGN.md is visual recovery of the built world
- [x] Path of the rewritten DESIGN.md is noted in Comments for ticket 17

## Comments

Rewritten `DESIGN.md` at repo root. Sidecar `.impeccable/design.json`. North Star from the shipped direction contract: "One-bit instrument workbench". Ticket 17 should attach both files plus this sequencing note.

## Plan unit

Tail (after finish review) in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
