---
title: "\"I expand the active market\" e2e step was a toggle, not idempotent — second call collapsed the row and hid the position card"
date: 2026-07-28
category: test-failures
module: web/tests/e2e/steps/common.ts
problem_type: test_failure
component: testing_framework
symptoms:
  - "supply.feature's \"Happy path — supply liquidity at a chosen rate\" scenario failed on its final assertion, `Then I see a \"LIQUIDITY\" position card`, even though the SUPPLY write had already confirmed successfully"
  - "The failure showed up several steps after the actual cause: the scenario expands the row, runs the SUPPLY flow, closes the modal, then calls `When I expand the active market` a second time before the final position-card assertion — and it is this second call that silently collapses the row"
  - "borrow.feature's \"Happy path — borrow against a stream via the rate ladder\" scenario has the identical shape (expand -> BORROW flow -> CLOSE -> expand again -> position-card assertion) and failed the same way"
  - "The second `.row-toggle` click bubbled to the parent `<tr onClick={() => onSelect(expanded ? null : market)}>` in web/components/MarketsTable.tsx — a pure toggle keyed off current state — and collapsed an already-expanded row instead of being the harmless no-op the test author assumed"
  - "Closing the action modal only runs `onClose={() => setActiveMode(null)}` in web/components/MarketsApp.tsx, which never touches which market row is expanded (`selectedMarket` state), so the row was still expanded when the step ran a second time"
root_cause: logic_error
resolution_type: test_fix
severity: medium
tags: [e2e, playwright, gherkin, step-idempotency, toggle-vs-ensure, row-expansion, test-authoring, position-list]
related_components: [web/components/MarketsTable.tsx, web/components/MarketsApp.tsx, web/tests/e2e/supply.feature, web/tests/e2e/borrow.feature]
---

# "I expand the active market" e2e step was a toggle, not idempotent — second call collapsed the row and hid the position card

## Problem

The shared Playwright/Gherkin step `When("I expand the active market", ...)` in `web/tests/e2e/steps/common.ts` was a plain toggle click with no check of the row's current expanded state. Any scenario that called it twice — once to open a market row, then again later to re-check something after closing an action modal — silently collapsed the row on the second call instead of leaving it open, because there was nothing "toggle-like" about the test author's intent even though the underlying DOM control was a pure toggle.

## Symptoms

- `web/tests/e2e/supply.feature`'s "Happy path — supply liquidity at a chosen rate" scenario failed on its final assertion, `Then I see a "LIQUIDITY" position card`, even though the SUPPLY write had already confirmed successfully (`Then I see the caption "CONFIRMED"` passed).
- The failure showed up several steps after the actual cause: the scenario expands the row, runs the SUPPLY flow, clicks CLOSE on the modal, asserts `Then no modal is open` (passes), then calls `When I expand the active market` a second time before the final position-card assertion — and it's this second call that silently collapses the row instead of confirming it's still open.
- `web/tests/e2e/borrow.feature`'s "Happy path — borrow against a stream via the rate ladder" scenario has the identical shape (expand → BORROW flow → CLOSE → expand again → `Then I see a "LOAN" position card`) and failed the same way.
- Grepping all `.feature` files for scenarios that invoke `When I expand the active market` more than once inside a single `Scenario` block confirms exactly these two: `supply.feature`'s "Happy path — supply liquidity at a chosen rate" and `borrow.feature`'s "Happy path — borrow against a stream via the rate ladder" (`adjust-rate.feature` calls the step only once per scenario in each of its three scenarios — it was not actually affected, despite looking like an obvious candidate given its name).
- Because the second call's effect (collapsing the row and unmounting the position list) looks identical from the test's point of view to "the position never rendered," the failure read exactly like a data-loading, query-invalidation, or Ponder-indexing race — a class of bug already confirmed elsewhere in this same e2e suite this session — rather than a plain click-ordering mistake inside the test's own step definitions.

## What Didn't Work

1. **Suspected a data-freshness / query-invalidation problem first.** The natural hypothesis: after a successful SUPPLY write confirms, does the hook backing the position list properly refetch and surface the newly created position? This was a reasonable, high-priority thing to check first, because a genuine instance of exactly this class of bug — Ponder-indexed data needing an explicit re-sync wait after fixture-direct writes — was independently confirmed elsewhere in the same suite this session (see the `Given("the frontend re-syncs with chain state", ...)` step and its surrounding comment in `common.ts`, lines 27-44, which documents that fixture-direct arrangement steps bypass the app's own write-triggered invalidation entirely).
2. **Manually drove the identical UI flow in a live browser** (expand → SUPPLY → fill → approve → confirm → close) to check whether the position card actually appears. It did — immediately, with the row still visibly expanded after closing the modal. This ruled out any staleness/refetch explanation: the position was demonstrably already there and rendered; the bug had to be in what the *second* "I expand the active market" call did to that already-correct state, not in whether the data ever arrived.
3. **Traced the actual failing Playwright step** (via its call-log / error-context output) back to precisely which click preceded the assertion failure, rather than assuming it was one of the earlier SUPPLY-flow steps. That pointed specifically at the second `When I expand the active market` call, which led to reading `MarketsTable.tsx` for what that click actually does.

## Solution

The step (`web/tests/e2e/steps/common.ts`, lines 60-64) now reads the toggle button's own `aria-expanded` attribute before acting, and is a no-op if the row is already expanded:

```ts
When("I expand the active market", async ({ page }) => {
  const toggle = page.locator("tr", { hasText: readSecondaryMaturityLabel() }).first().locator(".row-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
});
```

Previously it unconditionally located the row and clicked `.row-toggle` with no state check — every call was an unconditional toggle, not an "ensure expanded."

## Why This Works

Reading `web/components/MarketsTable.tsx` (lines 77-94) shows the actual toggle mechanics:

```tsx
<tr
  className={expanded ? "row-expanded" : undefined}
  onClick={() => onSelect(expanded ? null : market)}
>
  <td>
    <button type="button" className="row-toggle mono" aria-expanded={expanded}>
      {expanded ? "▾" : "▸"} {symbol}
    </button>
  </td>
  ...
```

The `.row-toggle` button has no `stopPropagation()`, so its click bubbles to the parent `<tr onClick={...}>`, which calls `onSelect(expanded ? null : market)` — a pure flip of `expanded ? null : market`, not an "ensure this market is selected" call. `expanded` itself is computed per-row as `selected?.market === market.market` (line 66), and `selected` is `MarketsApp.tsx`'s `selectedMarket` state.

Reading `web/components/MarketsApp.tsx` (lines 17-22 and 56-63) confirms the modal-close path never touches that state:

```tsx
// KTD1 two-level state: selectedMarket drives the expanded row; activeMode
// drives the overlay. Closing the overlay clears activeMode only — the row
// stays expanded. The overlay's scrim blocks the table while open, so the
// two can never point at different markets.
const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);
const [activeMode, setActiveMode] = useState<{ market: MarketInfo; action: ActiveAction } | null>(null);
...
{activeMode ? (
  <MarketDetail
    ...
    onClose={() => setActiveMode(null)}
  />
) : null}
```

`onClose` only calls `setActiveMode(null)`; `selectedMarket` is untouched. So after `CLOSE`, the row genuinely is still expanded — there is nothing between the two `expand` calls in either scenario that would have collapsed it. The test author's implicit assumption that a second "expand" call would be a safe no-op was wrong given the underlying control is a pure toggle: calling it again with the row already expanded flips it closed, unmounting `MarketRowDetail` (and the `PositionList` inside it) right before the very next assertion looks for a `.position-card` there. Checking `aria-expanded` first turns the step into a true idempotent "ensure expanded," matching what every calling scenario actually intended.

Because this fix lives in the single shared step definition rather than in any individual `.feature` file, it corrected both affected scenarios (`supply.feature` and `borrow.feature`) at once without touching either feature file.

## Prevention

- Any Playwright/Cucumber step whose name reads as an intent ("expand", "open", "enable") rather than a raw action ("click", "toggle") should check the current state via an observable attribute (`aria-expanded`, `aria-selected`, a CSS class, visibility) before acting, so it is idempotent regardless of how many times or where in a scenario it's called. Reserve unconditional-click steps for names that are explicitly toggle-shaped (compare the sibling step `When("I collapse the expanded market row", ...)` in the same file, which is fine as an unconditional click because its name and its one call site both assume the row starts expanded).
- When a shared step definition is reused across many `.feature` files, a bug in it can silently break scenarios that look otherwise unrelated (different feature, different assertion). Prefer fixing at the step-definition level over patching around it in individual scenarios — but that also means these steps deserve extra scrutiny before being marked "safe to call more than once."
- Review heuristic: grep step-definition files for `.click()` calls that aren't preceded by a state check (an attribute/class read or an `if`), and cross-reference against `.feature` files to see whether that same step is invoked more than once within a single `Scenario` block — that combination (unconditional click + multiple call sites in one scenario) is exactly the shape of this bug.
- When a failure surfaces several steps after the real cause (e.g., an assertion two steps past a `CLOSE` + re-expand), don't assume the culprit is the most complex-looking recent step (a data hook, a refetch); trace the actual failing locator back through the call log to find precisely which prior action changed the DOM out from under it.
- (session history) A keyboard-activation gap on this same toggle — Enter on the button not expanding the row — was found and fixed the day before in an accessibility sweep. That was a different defect (keyboard activation entirely broken) than this one (click-based idempotency), but both point at the same underlying control: worth a quick manual keyboard-and-click check on `.row-toggle` after any future change to `MarketsTable.tsx`'s expand/collapse handling, since both a11y and idempotency bugs have now independently surfaced there.

## Related Issues

- `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md` — documents the `MarketsTable.tsx` expandable-row architecture itself (`aria-expanded` on the row and toggle button, one-market-expanded-at-a-time) that this bug lives inside; useful component-side context for why checking `aria-expanded` is the correct fix.
- `docs/solutions/workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md` — a different bug (an async refetch race, not idempotency) in a sibling shared step definition, but the same recurring meta-lesson: a shared Gherkin step reused across scenarios/feature files can hide a latent bug that only a specific call pattern exposes, and the fix belongs in the step definition itself.
