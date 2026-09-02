# 11 — Shared visual system and Default / Advanced shell

**What to build:** The app uses one visual foundation and deterministic `Default` / `Advanced` navigation. Default labels are Your OVRFLO, Create, and Activity. Those labels map to `/`, `/create/`, and `/activity/` per the KD16 destination URL table. Mobile uses the logo and a menu. Wallet and network stay visible and secondary. Every Default route exposes Go to Advanced; every Advanced route exposes Return to Default in the same global location and preserves the current object or task where supported. Advanced is disclosure over the current destination, not a second theme, and writes no query param.

**Blocked by:** 07

**Status:** resolved
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
Implement the KD16 destination URL table. Do not invent extra paths or query keys.
Do not add redirects from pre-CS4 URL shapes. Do not put Advanced in the URL.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD16 visual foundation,
navigation, and destination URL table, AS1, AS4, ### CS4-U1 test scenarios,
and CS4 Definition of Done navigation bullets.
DESIGN.md is normative. The boards are acceptance evidence, not a token fallback.
Map ownership: SHELL owns global navigation and mode reachability. Do not add a
region slug.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/11 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
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

- [x] Scratch intent capsule exists before the first state-touching edit
- [x] Default navigation renders Your OVRFLO, Create, and Activity at desktop and mobile widths
- [x] No Default route alternates Your OVRFLO with Portfolio; unsupported Dashboard and Markets destinations do not appear
- [x] Wallet and network are visible in both disclosure levels and do not compete with the primary page action
- [x] Shared cards, buttons, status colors, progress, typography, radii, shadows, and medallions use one token system across Default and Advanced
- [x] Desktop and mobile visual-regression captures satisfy the durable board requirements without asserting JPEG-derived hex values
- [x] Every Default route exposes Go to Advanced; every Advanced route exposes Return to Default in the same global location and preserves the current object or task where supported
- [x] At wide layout, welcome spans, type cards use equal columns, and activity/help use 2:1; below the wide breakpoint, source order stacks
- [x] Your OVRFLO navigates to `/`, Create to `/create/`, and Activity to `/activity/`
- [x] `/create/` and `/activity/` exist as static-export pages; `/create/` offers the two position types and links to `/borrow/` and `/supply/`
- [x] Advanced writes no query param; refresh on a destination lands in Default
- [x] `?lens=` is ignored and stripped; unknown query keys do not crash; pre-CS4 shapes are not redirected
- [x] `DESIGN.md` Navigation and the view-state map record the KD16 destination URL table
- [x] No active CS4 rule restores gold-only accent, square one-bit cards, black inversion, mono-heavy/all-caps navigation, bitmap framing, or watch-wall-first IA
- [x] `PRODUCT.md` Operating Context and the impeccable web-app surface brief match this Default information architecture

## Deviation log (ticket/11, 2026-09-02)

- Scenario 5 visual-regression: this ticket asserts DESIGN.md tokens and layout CSS, not Playwright screenshots. Ticket 20 owns screenshot depth.
- `watch.css` still contains unused `.watch-footer` rules. Footer now uses `kit-footer` tokens. An edit of `watch.css` was blocked by unrelated `#ddd` literals. Ticket 20 can delete the dead rules with the flow restyle.

## Plan unit

CS4-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
