---
title: A scenario asserting an absence needs an explicit Given
date: 2026-07-29
category: test-failures
module: web/tests/e2e
problem_type: test_failure
component: testing_framework
symptoms:
  - Scenario passes or fails depending on which scenarios ran before it
  - Failure surfaces as an apparent regression in the most recently changed code
  - "Then there is no ... position group assertions fail only in some run orders"
root_cause: test_isolation
resolution_type: test_fix
severity: high
tags: [e2e, gherkin, playwright, test-isolation, order-dependence, absence-assertion]
---

# A scenario asserting an absence needs an explicit Given

## Problem

The `claim-all` scenario "empty position categories render nothing, not
placeholder text" asserted that three position groups were **absent**, but had
no `Given` establishing that they should be. It inherited whatever state
earlier scenarios left in the shared fork, so it passed or failed on run order.

## Symptoms

- The scenario passed in some suite runs and failed in others with identical code
- It failed reliably in any run that placed the borrow scenarios before it
- The failure looked like a regression in whatever landed most recently, because
  a code change that perturbs timing or ordering is enough to reveal it every time

## What Didn't Work

- **Blaming the most recent change.** The scenario began failing right after a
  new hook landed and correlated perfectly across four runs. Reverting the hook
  would have made the suite green and left the ordering dependency in place.
- **Re-running to confirm.** Repeat runs in the same configuration reproduce the
  same ordering, so they confirm the failure without discriminating its cause.

## Solution

Point the assertion at a market where absence is guaranteed by construction
rather than by luck. Every arrange step in this suite transacts against the
**secondary** market; the **primary** market is seeded but never touched by the
dev wallet, so it is empty no matter what ran first
(`web/tests/e2e/steps/common.ts:85`):

```ts
When("I expand a market I hold no positions in", async ({ page }) => {
  const toggle = page.locator("tr", { hasText: readPrimaryMaturityLabel() }).first().locator(".row-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
});
```

The step name carries the precondition (`a market I hold no positions in`)
instead of naming a UI target (`the active market`), so the guarantee is
readable from the feature file.

## Why This Works

A `Given` is not ceremony — it is what converts an assumption into a
precondition the suite establishes and can therefore rely on. A scenario that
asserts a **presence** fails loudly when its setup is missing, because the thing
it looks for is not there. A scenario that asserts an **absence** does the
opposite: with no setup, it *passes*, and keeps passing until unrelated state
drifts underneath it.

That asymmetry is why absence assertions rot silently and then surface as
someone else's regression. The fix is either to establish the empty state
explicitly, or — as here — to assert against a target whose emptiness is
structural and therefore cannot drift.

## Prevention

- **Any scenario whose `Then` is negative (`there is no …`, `is not visible`,
  `is empty`) must have a `Given` or a structurally-guaranteed target.** Treat a
  negative assertion with no arrange step as a defect in the scenario.
- **Name the step for the precondition, not the target.** "I expand a market I
  hold no positions in" states the contract; "I expand the active market" hides it.
- When a suite shares mutable state across scenarios, prefer a fixture the
  suite never writes to over asserting the absence of writes.

## Related Issues

- [Vary one thing before blaming your own change for a flake](../best-practices/vary-one-thing-before-blaming-your-own-change-for-a-flake.md) — the investigation that surfaced this, and the control that exonerated the suspected change
- [E2E shared fork requires serial workers until snapshot isolation](../architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md) — why scenarios share mutable state in the first place
- [Expand active market step toggle not idempotent](./expand-active-market-step-toggle-not-idempotent-collapses-position-list.md) — the sibling defect in the same step family
