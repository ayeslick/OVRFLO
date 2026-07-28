---
title: "Disabled per-stream BORROW placeholder shared its exact accessible name with the market-row BORROW button"
date: 2026-07-28
category: ui-bugs
module: web/components/PositionList.tsx
problem_type: ui_bug
component: nextjs_react
severity: medium
symptoms:
  - "Two distinct `<button>` elements could be mounted on screen at the same time with the identical accessible name \"BORROW\": the always-present market-row-level button in `MarketRowDetail.tsx` (opens the \"BORROW AGAINST STREAM\" modal) and, whenever a held stream had no postable liquidity yet, a disabled per-stream placeholder button inside `PositionList.tsx`'s `StreamCard`."
  - "`web/tests/components/position-cards.test.tsx`'s \"disables borrow with a reason when no real liquidity exists\" case (line ~168, prior to the fix) asserted `getByRole(\"button\", { name: \"BORROW\" })` while the market-row BORROW button was outside the component under test, but any full-page render (an e2e run, or a screen-reader pass) with both mounted would have two elements answering to that exact role+name query."
  - "In `web/tests/e2e/borrow.feature`'s \"Error state — no liquidity posted for this market\" scenario, the wallet holds an eligible stream but no lender has posted liquidity for the market — exactly the condition that renders the disabled placeholder — while the market-row BORROW button stays enabled (no caption applies: wallet connected, market not matured, streams available per `borrowCaption` in `MarketRowDetail.tsx` lines 72-74). Both \"BORROW\"-named buttons would have been on screen simultaneously in that scenario before the fix."
root_cause: logic_error
resolution_type: code_fix
related_components: [web/components/MarketRowDetail.tsx, web/tests/components/position-cards.test.tsx, web/tests/e2e/borrow.feature]
tags: [accessible-name, aria, playwright-locators, getByRole, duplicate-button-text, a11y, position-list, strict-mode]
---

# Disabled per-stream BORROW placeholder shared its exact accessible name with the market-row BORROW button

## Problem

`web/components/PositionList.tsx`'s `StreamCard` rendered a disabled placeholder button with the bare text "BORROW" whenever a held stream had no liquidity currently postable against it. `web/components/MarketRowDetail.tsx:183` independently renders its own market-row-level `BORROW` button (opens the "BORROW AGAINST STREAM" modal). Because a `StreamCard` renders as soon as a stream is eligible — independent of whether liquidity exists for that market — both buttons could be mounted on the page at once with the exact same accessible name, "BORROW."

## Symptoms

- Two distinct, simultaneously-mounted `<button>` elements both exposed the accessible name "BORROW": the enabled market-row button (`MarketRowDetail.tsx:183`) and the disabled per-stream placeholder (`PositionList.tsx`, inside `StreamCard`, prior to the fix).
- `web/tests/e2e/borrow.feature`'s "Error state — no liquidity posted for this market" scenario is the one real scenario in this repo's e2e suite that hits the exact triggering condition: the wallet holds an eligible stream (so `StreamCard` renders) and no lender has posted liquidity (so `teaserBps === null`, producing the disabled placeholder), while the market-row BORROW button stays enabled — `borrowCaption` in `MarketRowDetail.tsx` (lines 72-74) is only non-null when disconnected, lending isn't deployed, the market has matured, or there are no eligible streams at all, none of which apply in that scenario. `web/tests/e2e/claim-all.feature` has no scenario that combines a no-liquidity stream with a visible market-row BORROW button, so it isn't a candidate.
- No preserved test-results artifact or failure log in this repository ties this specific collision to an actual failed e2e run — `web/test-results/` currently has no subdirectories for `borrow.feature` runs. The fix landed inside commit `c1024d9`, a large multi-part commit ("fix: harden local E2E bootstrap and treat on-chain reverts as failures") that bundles many unrelated changes (live-head Anvil seeding, Pendle discovery ARG_MAX fix, wallet/AppKit split, tx-queue receipt checks, "fixture fixes from the first full suite run"). It is plausible this specific rename was one of those first-full-suite-run fixture fixes, but there is no isolated commit or log surviving that confirms `borrow.feature` actually failed on this collision rather than the fix being caught proactively (code review / accessible-name audit) while the author was already deep in that file for the unrelated per-source error-isolation work in the same commit. Framed honestly: this reads as a plausible-but-unconfirmed e2e failure candidate, not a documented one.

## What Didn't Work

There is no multi-step debugging trail to report here. The change sits inside a single diff hunk in a much larger commit, alongside an inline code comment that already states the exact rationale (quoted verbatim below) — the shape of a fix applied in one pass once the ambiguity was noticed, not a fix arrived at after ruling out other hypotheses. No failing test output, stack trace, or investigation notes for this specific collision survive in the repo or its commit history.

## Solution

`web/components/PositionList.tsx` lines 333-346 (inside `StreamCard`), the disabled placeholder now reads `BORROW STREAM {formatId(stream.streamId)}` instead of bare `BORROW`, with an inline comment explaining why:

```tsx
        ) : (
          <span className="action-with-caption">
            {/* Distinct accessible name from the market-row-detail's own
                "BORROW" button (MarketRowDetail.tsx) — both can be on screen
                at once (this card renders once a stream is eligible,
                independent of whether any liquidity has been posted yet),
                and an identical name on two buttons is ambiguous for
                assistive tech and test locators alike. */}
            <button className="button button-cyan mono" type="button" disabled>
              BORROW STREAM {formatId(stream.streamId)}
            </button>
            <span className="label mono">NO LIQUIDITY</span>
          </span>
        )}
```

`formatId` (`web/lib/format.ts:40-42`) renders a `bigint` stream ID as `#{id}` (e.g. `#7`), so the button's visible/accessible text becomes `BORROW STREAM #7`.

`web/tests/components/position-cards.test.tsx` line 168, in the "stream cards" describe block's "disables borrow with a reason when no real liquidity exists (own supply excluded)" test, was updated to match:

```tsx
    expect(screen.getByRole("button", { name: "BORROW STREAM #7" })).toBeDisabled();
```

(previously `expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();`).

## Why This Works

An element's "accessible name" — what screen readers announce and what Playwright/Testing Library's `getByRole(role, { name })` matches against — is derived from its text content (absent an explicit `aria-label`/`aria-labelledby`). Two `<button>` elements with the literal text "BORROW" are indistinguishable by accessible name even though they are different DOM nodes with different behavior (one opens a modal, one is inert). This is ambiguous on two fronts simultaneously:

- **Assistive technology**: a screen reader user tabbing through or querying "BORROW" controls has no way to tell the two apart by name alone; they'd need to rely on surrounding context read separately, which many screen reader interaction modes (e.g., jumping button-to-button) skip entirely.
- **Testing/automation locators**: `getByRole("button", { name: "BORROW" })` (or `/^BORROW$/`) matches both nodes. Playwright's strict mode throws on an ambiguous locator when awaited directly; the shared step definitions in `web/tests/e2e/steps/common.ts` (e.g. `When("I click the {string} button", ...)` at line 92-94) sidestep strict mode with `.first()`, which instead makes it silently resolve to whichever element happens to come first in DOM order — in this component tree, `PositionList` (containing `StreamCard`) renders before the `market-detail-actions` block in `MarketRowDetail.tsx` (lines 160 vs. 176-186), so `.first()` would resolve to the disabled per-stream placeholder rather than the intended, enabled market-row button. Since that placeholder is genuinely `disabled` at the DOM level, Playwright's actionability checks (which wait for an element to be enabled before clicking) would stall or fail rather than silently succeed on the wrong element — a real, if here unconfirmed, way this collision could break a scenario like `borrow.feature`'s "no liquidity posted" case.

Appending `{formatId(stream.streamId)}` fixes both problems at once, and generalizes beyond just the one collision with `MarketRowDetail.tsx`: since `stream.streamId` is unique per stream, every `StreamCard`'s placeholder button also gets a distinct name from every *other* `StreamCard`'s placeholder button when multiple no-liquidity streams render side by side in the same expanded market row — a scenario the plain "BORROW" text would have made just as ambiguous among themselves, not only against the market-row button.

## Prevention

- Review heuristic: before adding or reviewing any button whose accessible name is a static string literal (no dynamic id/data baked in), grep sibling and parent components that can be mounted at the same time for the same literal button text (e.g. `grep -rn '>BORROW<\|"BORROW"' web/components/`). If a match turns up in a component that can co-render with the one under review, the two names collide and at least one needs a disambiguating suffix (an ID, a count, a qualifying noun).
- General rule: any button rendered inside a list/repeated-item component (one instance per row, stream, position, etc.) should bake in the item's unique identifier as part of its accessible name whenever a plausible sibling button elsewhere in the tree could share the same static label — not just to avoid collisions with a specific known button, but so that N repeated instances of the same component are already unambiguous among themselves.
- When adding a Playwright/Testing-Library locator that uses `.first()` to sidestep a strict-mode violation, treat that `.first()` itself as a signal to go find out *why* more than one match exists — `.first()` silences the ambiguity error without resolving the ambiguity, and can quietly click the wrong (or disabled) element instead of failing loudly.

## Related Issues

- `docs/solutions/ui-bugs/positionlist-blanket-error-hides-onchain-positions.md` — same file (`PositionList.tsx`) and same session, but an unrelated defect class (per-source error-state flattening hiding real positions, not a naming collision).
- `docs/solutions/ui-bugs/marketrowdetail-unwrap-gate-compares-wrong-capacity-op.md` — most recent doc to touch `MarketRowDetail.tsx`'s row-level controls (a wrong capacity-comparison operator on the UNWRAP gate, not a naming defect), and names the same file whose bare "BORROW" button motivated this rename.
- `docs/solutions/test-failures/expand-active-market-step-toggle-not-idempotent-collapses-position-list.md` — the repo's only other a11y-adjacent `PositionList`/row-control doc; its Prevention section already notes that both accessibility and idempotency bugs have independently surfaced on the `.row-toggle` control, establishing a precedent for treating accessible-name/attribute correctness as a recurring risk area on this component family's interactive controls.
