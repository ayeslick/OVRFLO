---
title: "Web Markets UI Polish: Overlay Pattern, Asset Names, and Layout Fixes"
date: 2026-07-23
last_updated: 2026-07-27
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

> **Scope.** This doc captures the Jul 23, 2026 polish pass (close buttons, symbol reads, caption alignment, layout CSS, Reown 403). The Jul 27 markets rebuild changed primary navigation to **expandable rows + two-level overlay state** — see [web-markets-outcome-first-planners-and-tx-queue.md](../architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md) for the current architecture. Patterns below that still apply in production are marked **still current**; navigation-specific sections describe the Jul 23 fix and note what changed.

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

All seven issues were resolved in a single coordinated pass across `web/components/MarketsApp.tsx`, `web/components/MarketDetail.tsx`, `web/components/MarketsTable.tsx`, `web/components/ActionModal.tsx`, `web/lib/abis.ts`, and `web/app/globals.css`.

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

### 3. Asset names via batched `symbol()` reads (**still current**; refactored in `629d6ff`)

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

**Jul 23:** `MarketsTable` inlined `useReadContracts` per row batch. **Current (`629d6ff`):** one deduped batch in `useMarketSymbols`, called once in `MarketsApp` and threaded via `symbolFor(symbols, address)`:

```tsx
// MarketsApp.tsx
const symbols = useMarketSymbols(markets.markets);

// MarketsTable.tsx — per row:
const symbol = symbolFor(symbols, market.ovrfloToken);
```

The principle is unchanged: batch-read `symbol()` on-chain, fall back to `formatAddress` when a read fails or is loading. PT symbols are deliberately not read — PT rows render with underlying context.

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

### 5. MarketDetail converted from page to overlay (Jul 23 fix; navigation superseded Jul 27)

The core architectural change in the Jul 23 pass is in `MarketsApp.tsx`. **Before**, selection replaced the page:

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

**After (Jul 23):** the table and summary always render, and `MarketDetail` overlays on top when a market is selected.

**Current (Jul 27 rebuild):** two-level state — `selectedMarket` expands an inline `MarketRowDetail` row; `activeMode` opens a slim `MarketDetail` action overlay for deposit/borrow/supply only. Balances and positions live in the expanded row, not the overlay:

```tsx
// MarketsApp.tsx (current)
<MarketsTable
  selected={selectedMarket}
  onSelect={setSelectedMarket}
  onMode={(market, action) => setActiveMode({ market, action })}
/>
{activeMode ? (
  <MarketDetail
    market={activeMode.market}
    action={activeMode.action}
    onClose={() => setActiveMode(null)}
  />
) : null}
```

`MarketDetail` is now a pure action container (`FormBody` from `ActionModal.tsx`); the standalone `ActionModal` wrapper is no longer mounted from `MarketsApp`. Overlays still use `modal-scrim` / `modal-panel`, `role="dialog"`, `aria-modal="true"`, and `useFocusTrap`. Escape and scrim-click call `onClose()` directly.

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

**Overlay pattern (Jul 23).** The root cause of the page-replacement problem was conditional rendering that treated `MarketDetail` as a sibling alternative to the table. Always rendering the table/summary and appending the detail as an overlay preserved list context. The Jul 27 rebuild retained overlays for **actions only** and moved detail/balances into expandable rows — see the architecture doc for the two-level state model.

**Asset names.** `MarketInfo` carries only addresses, not symbols. Batch-reading `symbol()` via multicall populates human-readable labels without hardcoded mappings. Centralizing reads in `useMarketSymbols` avoids duplicate RPC calls when both table and summary need the same symbols.

**Caption alignment.** Wrapping button + caption in `.action-with-caption { display: flex; align-items: center; }` centers the caption against the button. **Still used** in `MarketRowDetail.tsx` and `PositionSummary.tsx`.

**Layout.** FEE/MATURITY in the header meta row and 1px graphite border separators follow the design system's section-divider rule. Action overlays use `max-height: 90vh; overflow-y: auto`.

**Close button.** Visible close buttons on `MarketDetail`, `ClaimAllModal`, and the legacy `ActionModal` component satisfy modal affordance without replacing Escape/scrim dismissal. **Still current.**

## Prevention

- **Prefer overlays over page replacement for detail views.** When a list-driven app needs to show detail for a selected row, render detail as a layer above the persistent list rather than conditionally swapping the list out. The Jul 27 rebuild uses **expandable rows for inline detail** and **overlays only for transaction forms** — see [web-markets-outcome-first-planners-and-tx-queue.md](../architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md).
- **Read human-readable names on-chain, don't hardcode them.** Batch-read `symbol()` via `useMarketSymbols` (or equivalent deduped multicall) rather than maintaining address-to-name mappings.
- **Guard Escape handlers when overlays stack.** If multiple overlay layers can be open simultaneously, each layer's Escape handler must check whether a higher layer is active before closing. The current markets flow uses a single action overlay per market, so `MarketDetail` closes directly on Escape; `ClaimAllModal` blocks scrim/Escape while a tx is in flight.
- **Align disabled-state captions with flex containers.** Wrap button + caption in `.action-with-caption { display: flex; align-items: center; }`.
- **Use border separators, not padding gaps, for section structure.** Sections divided by 1px graphite `border-top`; first section gets `border-top: none`.
- **Surface environment-config expectations in documentation.** The Reown 403 is benign but noisy. Set `NEXT_PUBLIC_REOWN_PROJECT_ID` in `.env.local` (from `cloud.reown.com`).

## Related Issues

- [web-markets-outcome-first-planners-and-tx-queue.md](../architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md) — **Successor (Jul 27).** Expandable rows, pure planners, display math, claim-all tx queue, and shared invalidation. Supersedes the MarketsApp navigation model from this doc while retaining overlay/symbol/caption patterns.
- [usd-prices-not-shown-in-modals-WebUI-20260421.md](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md) — Same category (ui_bug) and same broad surface area (web/ modals). Different problem, root cause, and solution.
- [modal-render-error-crashes-dashboard-WebUI-20260421.md](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md) — ModalErrorBoundary pattern. Close buttons and converted modals should keep headers outside the boundary (pattern #3).
- [ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md) — Pattern #3 (modal error boundaries; header/close button outside boundary).
