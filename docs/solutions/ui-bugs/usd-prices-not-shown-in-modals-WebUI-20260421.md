---
module: Web UI
date: 2026-04-21
problem_type: ui_bug
component: nextjs_react
symptoms:
  - "useUsdPrices hook computed underlyingUsd, ptUsd and ovrfloUsd maps, but nothing in the UI rendered them"
  - "NewOvrfloModal showed token amounts with no USD subline"
  - "ClaimModal showed OVRFLO balance, claimable PT and expected receive amount with no USD subline"
  - "Dashboard never called useUsdPrices, so the external CoinGecko fetch didn't fire"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [usd-pricing, dashboard, modals, coingecko, previewrate, useusdprices]
---

# Troubleshooting: USD prices computed but never rendered in modals

## Problem

The UI had a full `useUsdPrices` hook that combined CoinGecko's
`/simple/token_price/ethereum` endpoint with each OVRFLO's `previewRate(market)`
view function to derive `underlyingUsd`, `ptUsd` and `ovrfloUsd` price maps per
market. But no component actually consumed the hook, so the deposit and claim
modals displayed only token amounts without any USD context, and the external
HTTP request never fired during normal operation.

## Environment

- Module: Web UI (`web/`)
- Stack: Next.js 15 / React 19, TanStack Query 5, wagmi 2.x (`useReadContracts`),
  viem 2.x, CoinGecko public API (optional; configurable via
  `NEXT_PUBLIC_PRICE_API_URL`)
- Affected files:
  - `web/hooks/useUsdPrices.ts`
  - `web/components/Dashboard.tsx`
  - `web/components/NewOvrfloModal.tsx`
  - `web/components/ClaimModal.tsx`
  - `web/tests/components/Dashboard.test.tsx`
- Date solved: 2026-04-21
- Relies on contract view: `OVRFLO.previewRate(market) returns (uint256)`

## Symptoms

- Deposit preview rows in `NewOvrfloModal` showed `1,000 USDC` (and similar) but no
  `≈ $1,000.00` subline, even when CoinGecko was reachable.
- Claim preview rows in `ClaimModal` (OVRFLO balance, claimable PT, expected
  receive) had no USD sublines.
- A quick search for `useUsdPrices` across `web/components/**` returned no matches —
  confirming the hook existed but was never called.
- Network tab during a dashboard render contained only RPC and Envio traffic; no
  CoinGecko request.

## What Didn't Work

**Attempted Solution 1: Hardcode `underlyingUsd = 1` for stable-asset PTs
(USDC/USDT) to side-step pricing.**

- Why it failed: Correct for USDC/USDT only. The protocol is designed to work
  for any Pendle-approved PT, so a stablecoin-only shortcut was a regression the
  moment a non-stable underlying was listed. The `previewRate`-derived `ptUsd`
  path is the right generalization and was already implemented.

**Attempted Solution 2: Render USD sublines inside the modal from a bespoke
in-component fetch.**

- Why it failed: Duplicates logic the hook already did (caching via TanStack
  Query, batched `useReadContracts` for `previewRate`, memoized price maps).
  Also breaks the single-source-of-truth between Dashboard and modals.

## Solution

Plumb the existing `useUsdPrices` hook through from `Dashboard` into the two
modals and render USD sublines using the `formatUsdValue` helper the hook
already exports.

**`web/components/Dashboard.tsx`** — call the hook once near the top of the
component tree and pass its `data` down:

```tsx
import { useUsdPrices } from "@/hooks/useUsdPrices";

const { data: usdPrices } = useUsdPrices({
  underlyings: ovrflos.map((o) => o.underlying),
  markets: allMarkets,
});

// ...
<NewOvrfloModal
  open={depositOpen}
  onClose={() => setDepositOpen(false)}
  ovrflos={ovrflos}
  allMarkets={allMarkets}
  prices={usdPrices}
/>
<ClaimModal
  open={claimOpen}
  onClose={() => setClaimOpen(false)}
  ovrflos={ovrflos}
  allMarkets={allMarkets}
  prices={usdPrices}
/>
```

**`web/components/NewOvrfloModal.tsx`** — accept the `prices` prop and render
sublines for the immediate / streamed / fee preview rows:

```tsx
import {
  formatUsdValue,
  getOvrfloUsdForMarket,
  getUnderlyingUsd,
  type UsdPrices,
} from "@/hooks/useUsdPrices";

interface Props {
  // ...existing props
  prices?: UsdPrices;
}

// inside the component, for each preview row:
const underlyingUsd = getUnderlyingUsd(prices, selectedOvrflo?.underlying);
const immediateUsd = formatUsdValue(toUser, decimals, underlyingUsd);
// renders:
{immediateUsd && (
  <span data-testid="usd-immediate" className="...">≈ {immediateUsd}</span>
)}
```

`ClaimModal` follows the same shape with `getOvrfloUsdForMarket` +
`getPtUsdForMarket` for the three relevant rows (`usd-ovrflo-balance`,
`usd-claimable-pt`, `usd-receive`).

**`web/tests/components/Dashboard.test.tsx`** — mock `useUsdPrices` so tests
stay network-free:

```tsx
vi.mock("@/hooks/useUsdPrices", async () => {
  const actual = await vi.importActual("@/hooks/useUsdPrices");
  return {
    ...actual,
    useUsdPrices: () => ({ data: undefined, isLoading: false, error: null }),
  };
});
```

## Why This Works

`useUsdPrices` already did all the hard work:

1. Dedupe underlyings across all OVRFLO instances and hit
   `${PRICE_API_URL}/simple/token_price/ethereum?contract_addresses=...` once
   (5-minute stale time, `retry: 0` so a CoinGecko outage doesn't block the UI).
2. Batch `previewRate(market)` calls across every market via
   `useReadContracts`, producing `ptUsd = underlyingUsd × rate/1e18` and a
   maturity-aware `ovrfloUsd` (pre-maturity = `ptUsd`, post-maturity =
   `underlyingUsd`, since mature OVRFLO redeems 1:1 to underlying).
3. Export three tiny helpers (`getUnderlyingUsd`, `getPtUsdForMarket`,
   `getOvrfloUsdForMarket`) plus `formatUsdValue` for presentation.

The only missing link was consumption. Calling the hook once at the Dashboard
level (closest shared ancestor of both modals) keeps the TanStack Query cache
warm and passes the same `UsdPrices` object to both consumers, so the modals
never have to know how pricing is fetched.

`formatUsdValue` returns `undefined` when any input is missing, and the
consuming JSX conditionally renders the subline (`{maybe && <span>…</span>}`).
That means a CoinGecko outage, an unpriced underlying, or a stale RPC
`previewRate` gracefully degrades to "no USD subline" rather than erroring out.

## Prevention

- New hooks that drive user-visible values should land in the same PR as the
  component that consumes them. If the hook is written first, add a
  `screenshot:` or `data-testid:` acceptance check to the PR template.
- Add a lightweight guard in CI: `rg -l "^export function use" web/hooks/ |
  while read f; do rg -q "$(basename "$f" .ts)" web/components/ || echo
  "Unused hook: $f"; done`. Any hook that falls out of use (or was never
  wired up) surfaces immediately.
- Assert USD sublines render in tests when prices are injected
  (`expect(screen.getByTestId("usd-immediate")).toBeInTheDocument()`), so the
  plumbing stays covered after future modal rewrites.
- Treat external price providers as advisory — never gate a transaction on
  them. The modals should always render token amounts correctly even when
  `prices` is `undefined`, and they do.

## Related Issues

- See also: [../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md](../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md)
  — landed in the same session as the Sablier indexer revert.
- See also: [../developer-experience/post-refactor-dead-code-WebUI-20260421.md](../developer-experience/post-refactor-dead-code-WebUI-20260421.md)
  — the follow-up that removed `nativeUsd` and the unused CoinGecko
  `/simple/price?ids=ethereum` fetch once the UI proved it didn't need them.
