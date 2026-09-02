# 20 — Responsive, accessible, Advanced-parity proof

**What to build:** The shared visual system works at desktop and mobile widths. Primary actions and choice/collection rows meet a 44px minimum target on mobile. Keyboard operation, heading order, focus moves, live regions, associated field errors, accessible wallet labels, safe areas, overflow, and reduced motion hold on the named surfaces. Advanced stays on the same tokens and exposes only supported exact controls. Go to Advanced and Return to Default remain globally reachable.

**Blocked by:** 11, 15, 16, 17, 19

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/20-responsive-accessible-parity.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not wait on 18. Do not add a
second visual system for Advanced.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4
if this ticket touches client state.
Read Required reading below and the plan sections: KD16 visual foundation, AS4,
AS9 focus bullets, ### CS4-U6, Verification Contract successor *Responsive access*,
and CS4 Definition of Done accessibility bullets.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/20 in this worktree. Do not create another branch or
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
- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-ux)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Desktop and mobile visual-regression captures match the durable hierarchy, soft blue language, card density, and single-mobile-surface requirements
- [ ] Axe passes create, hub, collection, detail, waiting, completed, and error states at desktop and mobile widths
- [ ] Keyboard-only navigation operates cards, radios, disclosures, menus, collection rows, and primary actions with visible focus
- [ ] Collapsed stages preserve ordered progress semantics and heading order
- [ ] Field errors are associated and announced
- [ ] Quote refresh, pending, rejected, reverted, and confirmed changes announce through live regions
- [ ] Truncated wallet identity retains its full accessible label
- [ ] Decorative medallions are hidden from the accessibility tree
- [ ] Mobile safe areas hold, collections do not overflow horizontally, and reduced motion disables nonessential animation
- [ ] Advanced exposes supported exact controls without a separate visual foundation
- [ ] Route and stage navigation focus the destination heading; inline status retains focus; Back restores opener focus
- [ ] Go to Advanced and Return to Default remain globally reachable at desktop and mobile widths
- [ ] Mobile primary actions and choice/collection rows meet a 44px minimum target

## Plan unit

CS4-U6 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
