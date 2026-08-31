# 11 — Shared visual system and Default / Advanced shell

**What to build:** The app uses one visual foundation and deterministic `Default` / `Advanced` navigation. Default labels are Your OVRFLO, Create, and Activity. Mobile uses the logo and a menu. Wallet and network stay visible and secondary. Every Default route exposes Go to Advanced; every Advanced route exposes Return to Default in the same global location and preserves the current object or task where supported. Advanced is disclosure over the current destination, not a second theme.

**Blocked by:** 07

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/11-visual-system-shell.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not build create flows, portfolio
routing, recovery, or hosted conversion. Do not invent Dashboard or Markets
destinations unless PRODUCT.md or the active surface brief authorizes them.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD16 visual foundation and
navigation, AS1, AS4, ### CS4-U1 test scenarios, and CS4 Definition of Done
navigation bullets.
DESIGN.md is normative. The boards are acceptance evidence, not a token fallback.
Map ownership: SHELL owns global navigation and mode reachability. Do not add a
region slug.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `DESIGN.md`
- `PRODUCT.md`
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux / frontend-playbook)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Default navigation renders Your OVRFLO, Create, and Activity at desktop and mobile widths
- [ ] No Default route alternates Your OVRFLO with Portfolio; unsupported Dashboard and Markets destinations do not appear
- [ ] Wallet and network are visible in both disclosure levels and do not compete with the primary page action
- [ ] Shared cards, buttons, status colors, progress, typography, radii, shadows, and medallions use one token system across Default and Advanced
- [ ] Desktop and mobile visual-regression captures satisfy the durable board requirements without asserting JPEG-derived hex values
- [ ] Every Default route exposes Go to Advanced; every Advanced route exposes Return to Default in the same global location and preserves the current object or task where supported
- [ ] At wide layout, welcome spans, type cards use equal columns, and activity/help use 2:1; below the wide breakpoint, source order stacks
- [ ] No active CS4 rule restores gold-only accent, square one-bit cards, black inversion, mono-heavy/all-caps navigation, bitmap framing, or watch-wall-first IA
- [ ] `PRODUCT.md` Operating Context and the impeccable web-app surface brief match this Default information architecture

## Plan unit

CS4-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
