---
title: "A shared hook's hydration-safety precondition is call-site-dependent, not hook-dependent"
date: 2026-07-27
category: architecture-patterns
module: web/hooks/useNowSeconds.ts
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
last_updated: 2026-07-27
applies_when:
  - "Extracting a hand-rolled React pattern (clock state, geolocation, viewport size, any Date.now()/window/navigator read) into a shared hook for reuse across components"
  - "The app builds with `output: \"export\"` (or otherwise produces static HTML rendered once, ahead of when the client actually loads it) rather than per-request SSR"
  - "Deciding whether a component may safely call a hook that reads a live, non-deterministic value (time, randomness, browser APIs) during render"
tags: [hydration, nextjs, static-export, react-hooks, render-tree, output-export, wall-clock]
related_components: [MarketsTable, MarketRowDetail, PositionList]
---

# A shared hook's hydration-safety precondition is call-site-dependent, not hook-dependent

## Context

Ticket 13 in the web UX plan asked to de-duplicate a hand-rolled wall-clock pattern: `MarketRowDetail.tsx` and `MarketsTable.tsx` each independently did `useState<bigint | null>(null)` + `useEffect(() => setNowSeconds(BigInt(Date.now()...)), [])`, instead of using the shared `useNowSeconds()` hook already extracted for exactly this purpose (`web/hooks/useNowSeconds.ts`, used by `ActionModal.tsx` and `PositionList.tsx`). The ticket read as a pure consolidation — "just call the existing hook in both places."

`useNowSeconds()` reads the wall clock eagerly, via a `useState` lazy initializer:

```1:10:web/hooks/useNowSeconds.ts
export function useNowSeconds(live = false): bigint {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  ...
}
```

That is safe for `ActionModal.tsx` and `PositionList.tsx` specifically because both only ever mount after a user interaction that starts as unset client state (opening an action modal; expanding a market row) — by construction, neither is ever present in the page's initial render tree. Applying the same hook unmodified to `MarketsTable.tsx` would have been a regression, not a cleanup, because that component **is** unconditionally part of the initial tree (`web/app/page.tsx` → `MarketsApp` → `MarketsTable`, no `dynamic(..., {ssr:false})` anywhere) and this app builds with `output: "export"` (`web/next.config.ts`) — the initial HTML is static, generated once at `next build` time, not per request. An eager `Date.now()` read during that build-time render bakes a timestamp that is guaranteed to differ from the client's real clock at hydration (by however long the static artifact has been deployed), which is exactly the hydration-mismatch class React's hydration reconciliation warns about.

This is why the original hand-rolled code in `MarketsTable.tsx` used null-init + `useEffect` in the first place — that pattern renders `null` (or an equivalent placeholder) identically in the static markup and in the client's first hydration pass, then updates to the real value only after mount, purely client-side. The duplication the ticket flagged was real, but the two duplicated implementations were not actually testing the same precondition — one call site's safety was structural (only ever mounted after hydration), and one was the render-tree position itself.

## Guidance

Before consolidating a hand-rolled non-deterministic-value pattern (time, `Math.random()`, `window`/`navigator` reads, viewport size) into a shared hook, classify **each call site**, not just the hook, along one axis: **is this component guaranteed to be absent from the page's very first render** (the render that produces what the client hydrates against)? A component is guaranteed absent only when its mount is gated behind client-only state that starts unset (a modal's `activeMode`, an expanded row's `selectedMarket`) — not merely behind `"use client"`, which still participates in the initial render under both per-request SSR and `output: "export"` static export.

- **Guaranteed-absent call sites** (modals, expanded-row content, anything gated behind state that starts `null`/`false`) may safely use an eagerly-initializing hook — it is strictly better than null-init + effect, since it avoids an extra placeholder render.
- **Always-present call sites** (anything unconditionally part of the component tree the page mounts on load) need a variant that renders identically in the initial markup and the client's first hydration pass — null (or another static placeholder) until a `useEffect` fires, which only runs post-hydration, purely client-side.

When both shapes are legitimately needed, extract **two** functions from the same hook module rather than forcing one shape on every caller — e.g. `useNowSeconds()` (eager) alongside `useNowSecondsHydrationSafe()` (null-then-effect), both living in `web/hooks/useNowSeconds.ts`. This still satisfies the actual goal of "stop hand-rolling this in components" (both call sites now delegate to the shared module, and the hydration-safe variant itself is no longer duplicated locally) without forcing an unsafe shape onto a call site whose rendering position doesn't support it.

## Why This Matters

- **`output: "export"` amplifies staleness, it doesn't just enable it.** A per-request SSR mismatch is bounded by request latency (milliseconds); a static-export mismatch is bounded by how long the deployed build has been live (hours to weeks), so the bug is not a rare race — it fires on essentially every real page load once deployed.
- **"Use the existing hook" is not automatically a safe simplification.** A consolidation ticket that reads as purely mechanical can still hide a real behavioral divergence between call sites; the fix is to verify the shared abstraction's precondition holds at every call site being migrated to it, not just to trust that "it already works elsewhere."
- **The bug is silent until it isn't.** Nothing about the type system, the hook's return type, or a typical component test catches this — `bigint` is `bigint` whether it came from a safe or unsafe initializer, and unit tests that don't render through an actual `next build` + static-export pass will never see the mismatch.

## When to Apply

- Any time a hand-rolled `useState(null) + useEffect` pattern is being replaced by a hook with an eager `useState(() => ...)` initializer.
- Any Next.js app using `output: "export"`, or any React app with a genuine SSR boundary (Remix, standard Next.js SSR, Astro islands, etc.) — the render-tree-position question applies wherever an initial render is produced somewhere other than the exact moment + environment the client hydrates in.
- When reviewing a "de-duplication" or "use the shared X" ticket in general — the instinct to trust an existing abstraction is usually correct, but is worth a two-minute check when the abstraction touches non-deterministic values (time, randomness, viewport, locale) rather than pure data transforms.

## Examples

**Before** — two independent, subtly-different hand-rolled clocks:

```tsx
// MarketRowDetail.tsx (safe to make eager — only mounts post-hydration)
const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
const matured = nowSeconds !== null && nowSeconds >= market.expiryCached;

// MarketsTable.tsx (NOT safe to make eager — always in the initial tree)
const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
```

**After** — one shared module, two shapes, each call site gets the one its render-tree position actually supports:

```tsx
// web/hooks/useNowSeconds.ts
export function useNowSeconds(live = false): bigint { /* eager init */ }
export function useNowSecondsHydrationSafe(): bigint | null { /* null-then-effect */ }

// MarketRowDetail.tsx — guaranteed absent from the initial tree
const nowSeconds = useNowSeconds();
const matured = nowSeconds >= market.expiryCached;

// MarketsTable.tsx — unconditionally in the initial tree, output: "export"
const nowSeconds = useNowSecondsHydrationSafe();
```

Verification for this specific case: run `npm run build` (full static export) and grep the emitted `out/index.html` — a gitignored, generated-at-build-time file, not part of the tracked tree — for any baked unix-timestamp-shaped number. A clean grep confirms the always-present component rendered its null/placeholder state into the static markup rather than a build-time clock reading.

## Related

- [`wagmi-read-batching-requires-matching-enabled-predicates.md`](wagmi-read-batching-requires-matching-enabled-predicates.md) — a second, independent instance of the same meta-lesson ("before consolidating N call sites into one shared primitive, classify each call site's precondition individually — structural similarity is not evidence they match") in a different domain: data-fetching scheduling (`query.enabled` equality) instead of hydration/render-tree timing. Found via the same 2026-07-27 `/ce-simplify-code` pass over `web/*`.
