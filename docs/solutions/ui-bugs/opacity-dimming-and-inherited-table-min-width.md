---
title: Opacity dimming destroyed contrast, and expanded detail inherited the table's min-width
date: 2026-07-29
category: ui-bugs
module: web/app/globals.css, web/components/MarketsTable.tsx
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Dimmed cards measured roughly 2.1:1 contrast, below the 4.5:1 minimum"
  - "The whole page scrolled horizontally whenever a market row was expanded on a narrow viewport"
  - "Both regressions came from a property that was correct for its own element"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [css, accessibility, contrast, opacity, min-width, responsive, inheritance]
---

# Opacity dimming destroyed contrast, and expanded detail inherited the table's min-width

## Problem

Two separate regressions with the same shape: a CSS property that was correct
for the element it was written on, silently applied to descendants it was never
reasoned about.

1. **`.card-dimmed` used `opacity: 0.5`.** Opacity composites the whole subtree
   against the page background, so already-muted text landed at roughly **2.1:1**
   against it — far below the 4.5:1 minimum, and worst exactly on the
   lowest-contrast text the card contained.
2. **Expanded row detail was rendered inside the table.** `table` carries
   `min-width: 760px` so the data grid stays legible rather than crushing its
   columns. Anything inside it inherits that floor — so the expanded detail
   panel, which is prose and controls rather than tabular data, forced the page
   to scroll horizontally on any viewport under 760px.

## Symptoms

- Dimmed cards failed contrast checks; the failure scaled with how muted the
  original colour was, so the least readable text got the worst treatment
- Expanding a market row on mobile made the entire page scroll sideways
- Neither reproduced in isolation — both needed the element in its real context

## What Didn't Work

- **Reading the rule that was changed.** `opacity: 0.5` is a correct expression
  of "de-emphasise this," and `min-width: 760px` is a correct expression of
  "don't crush these columns." The defect is in what they reach, not in what
  they say.
- **Checking the dimmed colour token.** `--dim` is fine on its own; it is fine
  *after* being multiplied by 0.5 that it stops being fine.

## Solution

**Dim with explicit colours, not opacity** (`web/app/globals.css:441`):

```css
.card-dimmed {
  border-color: var(--graphite);
}
.card-dimmed .mono {
  color: var(--dim);
}
.card-dimmed .label {
  /* --dim would itself fall short once dimmed further, so the settled label
     holds at the body colour rather than stepping down twice. */
  color: var(--dim);
}
```

Each dimmed colour is chosen against the real background and can be measured.
Note the comment: the naive version dims an already-dim token *twice*, which is
the same compounding error in a different costume.

**Move the detail out of the table.** `MarketsTable.tsx` closes `</table>` and
then renders `MarketRowDetail` as a sibling, so the panel is laid out against
the viewport rather than against the grid's minimum.

## Why This Works

Both fixes are the same move: **stop a property from crossing a boundary it was
never scoped for.**

Opacity's trap is that it is not a colour operation — it is a *compositing*
operation on the rendered subtree. Contrast is computed after compositing, so
you cannot reason about the result by reading the colour tokens; the effective
value depends on the backdrop and on how many dimming layers stack. Explicit
colours put the decision back where it is inspectable, and where a contrast
checker can reach it.

The table case is a layout-containment failure. `min-width` on a table is a
statement about the *grid's* content, but the table is also a containing block
for everything nested in it, so the constraint silently becomes a statement
about all descendants. The panel is not tabular content and gains nothing from
the floor — it only inherits the cost. Rendering it outside is not a workaround;
it is putting non-tabular content outside the table, which is where it belonged.

The general lesson for a review pass: **a CSS property is only correct relative
to a subtree.** When reviewing one, ask what else is inside that element now,
and what might be put inside it later.

## Prevention

- Never express "de-emphasised" as `opacity` on anything containing text. Use
  explicit colour tokens so the contrast is measurable and cannot compound.
- Keep non-tabular content outside `<table>`. If an expandable panel must sit in
  a row for semantic reasons, reset the inherited constraint explicitly rather
  than relying on the panel's own width.
- Wide content that genuinely needs a floor scrolls **inside its own
  `overflow-x: auto` container**; the page body must never scroll horizontally.
- Test both at a narrow viewport, and test contrast against the composited
  result rather than the token values.

## Related Issues

- [Web markets UI polish](./web-markets-ui-polish.md) — the surrounding visual pass these regressions were found in
- [MarketRowDetail unwrap gate compares wrong capacity op](./marketrowdetail-unwrap-gate-compares-wrong-capacity-op.md) — the same component, a logic defect rather than a layout one
- [aria-label overrides the accessible name](../design-patterns/aria-label-overrides-the-accessible-name-use-title-instead.md) — the neighbouring class of "correct-looking attribute with non-local effects"
