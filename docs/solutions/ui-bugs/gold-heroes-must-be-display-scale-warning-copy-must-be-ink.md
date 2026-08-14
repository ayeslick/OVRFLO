---
title: Gold heroes must be display-scale; warning copy must be ink
date: 2026-08-14
category: ui-bugs
module: web/components/kit/hero-rolling.css, web/app/status-warning.css
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Watch earnings RollingNumber painted gold on paper at inherited body size"
  - ".status-warning in globals.css painted gold on paper at body size"
  - "Ticket 14 scored gold-on-paper below display scale as a fail"
  - "DESIGN.md still names those body-size gold exceptions as shipped"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [gold-on-paper, display-scale, hero-rolling, status-warning, rolling-number]
related_components: [web/components/kit/RollingNumber.tsx, web/tests/inventory/product-truth.test.ts]
---

# Gold heroes must be display-scale; warning copy must be ink

## Problem

Ticket 14 scored gold text on paper below display scale as a fail. Watch
earnings used `RollingNumber` `accent="gold"` with no display-scale size.
`.status-warning` in `globals.css` painted `--gold` at body size.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- `.kit-rolling[data-accent="gold"]` set `color: var(--gold)` with inherited
  type (`web/components/kit/kit.css:275-277`).
- `.status-warning { color: var(--gold) }` still sits in
  `web/app/globals.css:193-195`.
- Borrow `YOU RECEIVE` was already gold at 36px
  (`web/components/borrow/borrow.css:66-70`). Watch earnings was not.
- Ticket 16 wrote `DESIGN.md` before this override. That file still names the
  body-size exceptions.

## What Didn't Work

Editing `DESIGN.md` does not change paint. Ticket 16 recovered the visual
system from CSS that still failed the gold-on-paper rule.

Deleting `.kit-rolling[data-accent="gold"]` would drop the allowed display-scale
hero. The rule is size, not "never gold on paper."

## Solution

`hero-rolling.css` sizes `.kit-hero .kit-rolling` to 36px
(`web/components/kit/hero-rolling.css:1-4`). `RollingNumber` imports that file
(`web/components/kit/RollingNumber.tsx:7`). Supplied earnings sits in
`.kit-hero` with `accent="gold"`
(`web/components/watch/SuppliedDetail.tsx:61-67`).

Outstanding uses the same 36px hero and does **not** set `accent="gold"`
(`web/components/watch/BorrowedDetail.tsx:82-99`). Display-scale is not gold.

`status-warning.css` sets `.status-warning { color: var(--ink) }`
(`web/app/status-warning.css:1-3`). `layout.tsx` imports `globals.css` then
this override (`web/app/layout.tsx:4-5`). Cascade order is load-bearing.
`globals.css` still contains the gold rule.

Product-truth test pins 36px on the hero file and `--ink` on the warning file
(`web/tests/inventory/product-truth.test.ts:97-102`).

## Why This Works

Display-scale gold (36px) is the allowed exception, matching Borrow YOU
RECEIVE. Body-size warning copy is ink. The override file must load after
`globals.css` or gold returns.

## Prevention

- Keep gold `RollingNumber` inside `.kit-hero`. Outside that wrapper, accent
  gold is body-size on paper.
- Do not remove the `status-warning.css` import, and do not move it above
  `globals.css`.
- Do not treat the Ticket 16 `DESIGN.md` gold-on-paper paragraph as current
  without a later document pass.
- Keep the product-truth test on both files. A test that only reads
  `globals.css` would miss the override.

## Related Issues

- [Borrow presentation must not announce read failures as true zero](borrow-presentation-must-not-announce-read-failures-as-true-zero.md)
  — fail-closed presentation kin; this learning is visual honesty for accent.
- [OVRFLO Web Standard](../patterns/ovrflo-web-standard.md)
  — Markets frontend micro-decisions; does not yet state the gold-on-paper size
  rule.
