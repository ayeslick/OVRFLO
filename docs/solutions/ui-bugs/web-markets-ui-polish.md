---
title: "Web Markets UI Polish: Overlay Pattern, Asset Names, and Layout Fixes"
date: 2026-07-23
category: docs/solutions/ui-bugs
module: web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - ActionModal overlay had no close button; users had to press Escape or click the scrim to dismiss it
  - "Redundant 'MARKETS' label appeared above the 'Approved Pendle Series' heading in the markets table"
  - Markets table Asset column displayed truncated contract addresses instead of human-readable token names
  - "Disabled 'NO STREAMS AVAILABLE' caption text was vertically top-aligned instead of centered within its button"
  - Selecting a market replaced the entire page via full-page navigation instead of opening an overlay modal, and the layout suffered from large gaps and cramping with content shoved to one side
root_cause: logic_error
resolution_type: code_fix
severity: low
tags: [modal-overlay, market-detail, close-button, asset-names, layout-fix, nextjs, wagmi]
---

# Web Markets UI Polish: Overlay Pattern, Asset Names, and Layout Fixes

## Problem

The OVRFLO web frontend (Next.js + wagmi + viem) shipped with several UI/UX defects that broke the "Architectural Dark" design intent: overlays lacked a visible close affordance, the markets table showed raw contract addresses instead of human-readable asset names, disabled captions were misaligned, selecting a market replaced the entire page instead of overlaying, and the market detail panel had large layout gaps and cramping. A separate `[Reown Config] 403` console error also surfaced during local development.

## Symptoms

- **No visible close button on overlays.** ActionModal and MarketDetail supported Escape-key and scrim-click dismissal, but presented no on-screen "✕" button, leaving users without an obvious, discoverable way to close the panel.
- **Redundant "MARKETS" label.** A mono `MARKETS` label sat directly above the `Approved Pendle Series` `<h2>` heading in the markets table, duplicating the topbar nav label and adding visual noise.
- **Addresses instead of asset names.** The markets table Asset column rendered `formatAddress(market.ovrfloToken)` (e.g. `0x1a2b…9f`) instead of a readable symbol like `ovrfloETH`, making the table unscannable.
- **"NO STREAMS AVAILABLE" vertically misaligned.** When the BORROW button was disabled (no eligible streams), the `NO STREAMS AVAILABLE` caption appeared glued to the top edge of the button rather than vertically centered against it.
- **Market detail replaced the page.** Selecting a market swapped the entire viewport to `MarketDetail` via conditional rendering, discarding the table and position summary context. The user wanted an overlay modal with action buttons opening further overlays (stacking), matching the existing `ActionModal` pattern.
- **Layout gaps and cramping.** Inside the market detail panel, a large gap separated the FEE/Maturity info from the action buttons, and content was cramped to one side of the page rather than centered.
- **`[Reown Config] 403` console error.** Reown AppKit logged a 403 fetching remote config with the placeholder (all-zeros) project ID.

## What Didn't Work

The original three-screen design used a page-based approach: `MarketsApp` conditionally rendered *either* `MarketDetail` *or* the `MarketsTable` + `PositionSummary` pair, treating market selection as full-page navigation. This did not match the desired overlay pattern — selecting a market threw away the table context, and there was no way to stack an `ActionModal` on top of a detail view because the detail view was the page, not a layer. A simple close button or layout tweak could not fix the architectural mismatch; the rendering strategy itself had to change from page-replacement to always-render-table-plus-overlay.

For the asset-name issue, the initial table had no on-chain `symbol()` read at all — it only had the `MarketInfo` struct fields (`vault`, `market`, `ovrfloToken`, `ptToken`, etc.), none of which carried a human-readable name, so `formatAddress` was the only available fallback.

## Solution

All seven issues were resolved in a single coordinated pass across `MarketsApp.tsx`, `MarketDetail.tsx`, `MarketsTable.tsx`, `ActionModal.tsx`, `lib/abis.ts`, and `globals.css`.

### 1. Visible close button on overlays

A `modal-close` button was added to the header of both `ActionModal` and `MarketDetail`. The modal header uses flexbox to push the close button to the right:

```tsx
<div className="modal-header">
  <div>
    <h3 className="modal-heading">{symbol}</h3>
    <div className="market-detail-meta">
      <span className="mono">FEE {formatAprBps(market.feeBps)}</span>
      <span className="mono">MATURITY {formatMaturity(market.expiryCached)}</span>
    </div>
  </div>
  <button type="button" className="modal-close" onClick={onBack} aria-label="Close">
    ✕
  </button>
</div>
```

CSS for the close button, consistent with the design system's transparent-border / hover-invert button rule:

```css
.modal-close {
  background: transparent;
  border: none;
  color: var(--dim);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  line-height: 1;
  transition: color 0.2s ease;
}

.modal-close:hover {
  color: var(--chalk);
}
```

### 2. Removed redundant "MARKETS" label

The `<div className="label mono">MARKETS</div>` was removed from `MarketsTable.tsx`. The `Approved Pendle Series` `<h2>` heading is sufficient, and the topbar already carries a `MARKETS` nav label.

### 3. Asset names via batched `symbol()` reads

A `symbol` function was added to `erc20Abi` in `web/lib/abis.ts`:

```ts
{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "string" }],
},
```

`MarketsTable` now uses `useReadContracts` to batch-read `symbol()` from each market's `ovrfloToken` in a single multicall, then renders the symbol in the Asset column with a `formatAddress` fallback if a read fails:

```tsx
const symbolReads = useReadContracts({
  contracts: markets.map((market) => ({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "symbol" as const,
  })),
  query: { enabled: markets.length > 0 },
});

const symbols = symbolReads.data ?? [];

// Per row:
const symbolResult = symbols[index];
const symbol = symbolResult?.status === "success" ? symbolResult.result : undefined;
// Rendered: <div className="mono">{symbol ?? formatAddress(market.ovrfloToken)}</div>
```

`MarketDetail` does a single `useReadContract` for the selected market's symbol and falls back to `formatAddress(market.ovrfloToken)`.

### 4. Vertically centered disabled captions

Each button + caption pair was wrapped in an `.action-with-caption` div so the caption centers against the button rather than aligning to its top:

```tsx
<div className="action-with-caption">
  <button
    className="button button-cyan mono"
    type="button"
    disabled={eligibleStreams.length === 0}
    onClick={() => setActiveAction({ type: "borrow" })}
  >
    BORROW
  </button>
  {eligibleStreams.length === 0 ? <span className="label mono">NO STREAMS AVAILABLE</span> : null}
</div>
```

```css
.action-with-caption {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```

### 5. MarketDetail converted from page to overlay

The core architectural change is in `MarketsApp.tsx`. **Before**, selection replaced the page:

```tsx
// Before: conditional rendering (page replacement)
{selectedMarket ? (
  <MarketDetail ... />
) : (
  <>
    <MarketsTable ... />
    <PositionSummary ... />
  </>
)}
```

**After**, the table and summary always render, and `MarketDetail` overlays on top when a market is selected:

```tsx
// After: always render table, overlay on top
<MarketsTable markets={markets.markets} selected={selectedMarket} onSelect={setSelectedMarket} />
<PositionSummary markets={markets.markets} user={connectedAddress} />

{selectedMarket ? (
  <MarketDetail
    market={selectedMarket}
    user={connectedAddress}
    onBack={() => setSelectedMarket(null)}
  />
) : null}
```

`MarketDetail` now uses the same `modal-scrim` / `modal-panel` pattern as `ActionModal`, with `role="dialog"` and `aria-modal="true"`. A `useFocusTrap(panelRef, true)` hook constrains Tab/Shift+Tab cycling within the overlay. An Escape handler closes the overlay, but only when no `ActionModal` is stacked on top — it checks `!activeAction`:

```tsx
useFocusTrap(panelRef, true);

useEffect(() => {
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape" && !activeAction) onBack();
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
}, [onBack, activeAction]);
```

Scrim click closes the overlay (`onClick={onBack}` on `.modal-scrim`, with `e.stopPropagation()` on the panel). The `ActionModal` stacks on top of `MarketDetail` naturally via DOM order — it is rendered after `MarketDetail` in the same fragment, so it paints above and receives the Escape event first.

### 6. Layout fixes in the overlay

FEE and MATURITY moved into a compact `.market-detail-meta` row next to the asset symbol in the header, instead of occupying a separate section. Sections use thin 1px graphite border separators rather than large `padding-top` gaps:

```css
.market-detail-panel {
  max-width: 640px; /* wider than ActionModal's 500px to fit balances + positions + actions */
}

.market-detail-meta {
  display: flex;
  gap: 1.5rem;
  margin-top: 0.35rem;
  color: var(--dim);
  font-size: 0.78rem;
}

.market-detail-section {
  padding-top: 1.25rem;
  border-top: 1px solid var(--graphite);
}

.market-detail-section:first-of-type {
  border-top: none;
  padding-top: 0;
}

.market-detail-actions {
  display: flex;
  gap: 1rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--graphite);
}
```

The panel is centered in the viewport via the existing `.modal-scrim { align-items: center; justify-content: center; }`, and the panel has `max-height: 90vh; overflow-y: auto;` so long position lists scroll within the overlay rather than overflowing the viewport.

### 7. Reown Config 403 (configuration, not code)

This is expected behavior when running locally without a real Reown project ID. The default `reownProjectId` is all zeros (`00000000000000000000000000000000`); the SDK attempts to fetch remote config, receives a 403, and falls back to local defaults. The fix is environment configuration only — set `NEXT_PUBLIC_REOWN_PROJECT_ID` in `.env.local` with a project ID obtained from `cloud.reown.com`. No code change is needed.

## Why This Works

**Overlay pattern.** The root cause of the page-replacement problem was a conditional-rendering strategy that treated `MarketDetail` as a sibling alternative to the table rather than as a layer above it. By always rendering the table/summary and conditionally appending `MarketDetail` as a sibling overlay, the table context is preserved underneath and the existing `.modal-scrim` / `.modal-panel` stacking mechanics apply. DOM order resolves the z-index stacking for free: because `ActionModal` is rendered after `MarketDetail` within `MarketDetail`'s fragment, it paints on top and its Escape handler fires first. The `!activeAction` guard in `MarketDetail`'s Escape handler ensures that pressing Escape while an `ActionModal` is open closes *only* the action modal, not the detail overlay behind it.

**Asset names.** `MarketInfo` carries only addresses, not symbols, so the table had nothing human-readable to display. Reading `symbol()` directly from each `ovrfloToken` contract via `useReadContracts` multicall populates the column with the real on-chain token symbol (e.g. `ovrfloETH`) without changing the data model or adding a hardcoded mapping. The per-read `status === "success"` check provides a graceful `formatAddress` fallback if a call reverts or is still loading, so the table never shows a blank cell.

**Caption alignment.** The misalignment was caused by the caption being a sibling of the button without a shared flex container, so it aligned to the row's top baseline. Wrapping the pair in `.action-with-caption { display: flex; align-items: center; }` makes the caption a flex item that centers against the button's box, matching the design system's "never hide an action, disable it and say why in a dim mono caption" rule.

**Layout.** Moving FEE/MATURITY into the header meta row and replacing large vertical padding with 1px graphite border separators follows the design system's section-divider rule: structure is conveyed through borders and subtle background shifts, not gaps. The `:first-of-type` exception removes the border on the first section so it doesn't collide with the header. Centering the panel via the existing scrim flexbox and capping `max-height: 90vh` with `overflow-y: auto` ensures the overlay stays viewport-bounded regardless of position-list length.

**Close button.** Adding a visible close button satisfies the modal pattern affordance without altering the existing Escape/scrim dismissal paths — it is additive, not a replacement. The transparent-background / hover-to-chalk styling matches the design system's button rule.

## Prevention

- **Prefer overlays over page replacement for detail views.** When a list-driven app needs to show detail for a selected row, render the detail as an overlay above the persistent list rather than conditionally swapping the list out. This preserves context, enables stacking (detail then action), and reuses the existing scrim/panel/focus-trap infrastructure. The page-replacement pattern should be reserved for genuine route changes.
- **Read human-readable names on-chain, don't hardcode them.** For any table that lists token-bearing entities, batch-read `symbol()` (and `decimals()` if needed) via `useReadContracts` multicall rather than maintaining an address-to-name mapping. On-chain reads are self-updating and survive new deployments; hardcoded mappings go stale and require code changes for every new market.
- **Guard Escape handlers for stacked overlays.** When overlays can stack (detail + action), each layer's Escape handler must check whether a higher layer is active before closing. Without the `!activeAction` guard, Escape would tear down two layers at once.
- **Align disabled-state captions with flex containers.** Always wrap a button and its explanatory caption in a shared `display: flex; align-items: center` container so the caption stays vertically centered against the button regardless of font size or line-height differences.
- **Use border separators, not padding gaps, for section structure.** Follow the design system: sections are divided by 1px graphite `border-top`, not by large `padding-top` values. The first section in a panel gets `border-top: none` to avoid a double rule against the header.
- **Surface environment-config expectations in documentation.** The Reown 403 is benign but noisy in the console. Document that `NEXT_PUBLIC_REOWN_PROJECT_ID` must be set in `.env.local` (with a link to `cloud.reown.com`) so developers don't mistake the 403 for a bug.

## Related Issues

- [usd-prices-not-shown-in-modals-WebUI-20260421.md](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md) — Same category (ui_bug) and same broad surface area (web/ modals). That doc fixed USD price sublines not rendering in modals; this doc fixes UI polish/layout in ActionModal/MarketDetail/MarketsTable. Different problem, root cause, and solution.
- [modal-render-error-crashes-dashboard-WebUI-20260421.md](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md) — Same modal surface area. Establishes the ModalErrorBoundary pattern. Related structural context since this doc adds close buttons and converts MarketDetail into a modal.
- [ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md) — Pattern #3 (modal bodies wrapped in a class-component error boundary; header/close button must stay outside the boundary so the user always has a dismiss path) is directly relevant. The close-button-placement rule and its enforcement grep apply to the new/converted modal.
