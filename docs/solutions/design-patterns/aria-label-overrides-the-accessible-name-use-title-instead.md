---
title: aria-label overrides the accessible name — put purpose in title instead
date: 2026-07-29
category: design-patterns
module: web/components/CopyValue.tsx
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Adding a copy, expand, or icon affordance to a control that renders a value
  - A control's visible text is what tests and screen readers identify it by
  - Reaching for aria-label to explain what a button does
tags: [accessibility, aria-label, accessible-name, playwright, testing-library, title]
---

# aria-label overrides the accessible name — put purpose in title instead

## Context

`CopyValue` was added so a user could recover a full stream id, loan id, or
address from truncated display text (requirement R27 / finding L-13). The
instinct is to explain the control with `aria-label="Copy stream id"`.

That would have been a silent, wide breakage. `aria-label` does not *add* a
description — it **replaces** the accessible name. A button that visibly reads
`0x7099…79C8` would announce, and be queryable as, something else entirely.

The repo's E2E suite identifies the connected wallet by exactly that name
(`web/tests/e2e/fixtures/mock-wallet.ts:25`):

```ts
await expect(page.getByRole("button", { name: formatAddress(DEV_WALLET_ADDRESS) })).toBeVisible();
```

Every scenario calls `waitForWalletConnected`. An `aria-label` on that control
would have failed the entire suite at once — and, worse, would have been read
as an accessibility *improvement* while making the control harder to refer to.

## Guidance

**Let the accessible name come from the visible text. Put purpose and the
untruncated value in `title`.**

```tsx
<button
  type="button"
  className="copy-value mono"
  title={`${label ?? "Copy"}: ${value}`}
  onClick={copy}
>
  {display}
  <span aria-hidden="true" className="copy-value-icon">{copied ? "✓" : "⧉"}</span>
</button>
```

Three parts to it:

- **Name from text.** `display` is the truncated value, so what a screen reader
  announces matches what a sighted user sees and what a locator matches.
- **Purpose and full value in `title`.** It becomes the *description*, not the
  name — additive rather than replacing. It also doubles as the recovery path
  when the clipboard is unavailable (denied permission, non-secure context), so
  the value stays readable off-screen either way.
- **Decorative icon `aria-hidden`.** Otherwise the glyph joins the accessible
  name and the announced text drifts from the visible text again.

Reach for `aria-label` only when a control has **no** visible text (an icon-only
button), or when the visible text is genuinely ambiguous *and* you are prepared
for the name to change everywhere it is referenced.

## Why This Matters

The failure mode is that this looks like the fix rather than the bug.
`aria-label` is the best-known accessibility attribute, adding one feels
unambiguously helpful, and nothing warns you — the page renders identically, the
label is *correct*, and only the machine-readable identity of the control has
silently changed underneath.

That identity is load-bearing in two places that never appear in the diff:

- **Assistive technology.** A user who is told the button is called "Copy stream
  id" cannot connect it to the `0x7099…79C8` a sighted colleague is reading
  aloud. The mismatch between spoken and visible name is itself an
  accessibility defect — WCAG's label-in-name requirement exists for exactly it.
- **Every name-based locator.** Playwright's `getByRole(role, { name })` and
  Testing Library's `getByRole` resolve the same accessible name the screen
  reader does. Changing it is an API change to the test suite, made from a file
  that contains no tests.

The general rule: **the accessible name is an interface, not a decoration.**
Anything that overrides it — `aria-label`, `aria-labelledby`, an unhidden icon,
appended status text — is a breaking change to two consumers that will not tell
you they broke.

## When to Apply

- Any control whose visible text is an identifier (address, id, hash, amount)
- Before adding `aria-label` to something that already renders text
- When adding icons or badges *inside* an existing button — hide them

## Examples

**Rejected — replaces the name every consumer matches on:**

```tsx
<button aria-label={`Copy ${label}`} onClick={copy}>{display}</button>
```

**Adopted — name preserved, purpose and full value added as description:**

```tsx
<button title={`${label ?? "Copy"}: ${value}`} onClick={copy}>{display}</button>
```

## Related

- [Disabled per-stream BORROW placeholder shared its accessible name](../ui-bugs/stream-card-borrow-button-accessible-name-collides-with-market-row-borrow.md) — the other direction, two controls colliding on one name
- [Uniform timeout durations are an environment signal](../best-practices/uniform-timeout-durations-are-an-environment-signal.md) — what a suite-wide locator break looks like when it does land
