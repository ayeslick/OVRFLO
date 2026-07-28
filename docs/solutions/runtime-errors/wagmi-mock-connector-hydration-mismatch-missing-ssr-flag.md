---
title: "Wallet button hydration mismatch: E2E mock wagmi connector was missing ssr: true"
date: 2026-07-28
category: runtime-errors
module: Web UI
problem_type: runtime_error
component: nextjs_react
symptoms:
  - "React hydration mismatch on every page load in the E2E (NEXT_PUBLIC_E2E=1) build, reported on the wallet-connect button in components/WalletButton.tsx"
  - "Mismatch diff shows the server rendering \"CONNECT\" while the client renders the already-connected wallet address (0x7099...79C8)"
  - "Next.js dev server terminal output shows the exact same hydration-mismatch stack trace on nearly every reload, at the same file:line (WalletButton.tsx:45 / :69)"
  - "Browser dev-tools overlay \"Issues\" badge shows 1 issue (the hydration warning) on almost every load"
  - "In-flight form/wallet UI state silently resets and clicks on stale DOM nodes silently no-op, initially mistaken for unrelated E2E test flakiness because React recovers from the mismatch instead of crashing"
root_cause: config_error
resolution_type: config_change
severity: medium
tags: [wagmi, hydration-mismatch, ssr, mock-connector, nextjs, e2e, wallet-connect]
related_components: [testing_framework, tooling]
---

# Wallet button hydration mismatch: E2E mock wagmi connector was missing ssr: true

## Problem

Under the Next.js E2E build (`NEXT_PUBLIC_E2E=1`) of `web/`, the wallet button intermittently hydration-mismatched: the server-rendered markup showed the disconnected `CONNECT` label while the client's first render showed the already-connected, formatted dev-wallet address, causing React to discard and regenerate the whole client tree on that page.

## Symptoms

```
<unknown> (https://react.dev/link/hydration-mismatch)
    at button (<anonymous>)
    at E2EWalletButton (components/WalletButton.tsx:45:7)
    at WalletButton (components/WalletButton.tsx:69:18)
    at MarketsApp (components/MarketsApp.tsx:42:11)
    at Page (app/page.tsx:7:7)
```

(Paths above are Next.js's own stack trace, relative to its project root, `web/` — i.e. `web/components/WalletButton.tsx`, `web/app/page.tsx`.)

The mismatch diff showed the server rendering the button text `CONNECT` while the client rendered the connected wallet's formatted address (`0x7099…79C8`) — same DOM node (`web/components/WalletButton.tsx:45`, the `<button>` inside `E2EWalletButton`), different text content, on every page that mounts `WalletButton`.

## What Didn't Work

1. **Assumed the `isE2E` conditional split itself was the bug.** `web/components/WalletButton.tsx` had just been split into `ProductionWalletButton` (real Reown `useAppKit()`) and `E2EWalletButton` (wagmi `mock` connector), gated by:
   ```tsx
   export function WalletButton() {
     return isE2E ? <E2EWalletButton /> : <ProductionWalletButton />;
   }
   ```
   The instinct was to treat this as a server/client branching antipattern (the classic `if (typeof window !== 'undefined')` mistake). Ruled out: `isE2E` comes from `NEXT_PUBLIC_E2E`, a `NEXT_PUBLIC_*` env var inlined at build/dev-server-start time — it evaluates identically on the server and the client, so it's not a runtime branch and can't itself produce a mismatch. The split was necessary and correct on its own: calling `useAppKit()` without `createAppKit()` having run throws "Please call createAppKit before using useAppKit" and 500s the whole page under `NEXT_PUBLIC_E2E=1` (see the comment at `web/components/WalletButton.tsx:8-12`, and `web/lib/wagmi.ts`'s `ensureAppKit()`, which skips `createAppKit` entirely when `isE2E`). The split didn't introduce the bug — it exercised a previously-dormant code path (the mock connector's `defaultConnected`+`reconnect` auto-connect) for the first time, which is what exposed a pre-existing gap in the wagmi config.

2. **Tried a tight, scripted `curl`-based reproduction loop first**, repeatedly fetching the raw server HTML and diffing it against a fresh browser load, hoping to catch the exact moment of divergence. This did not reliably reproduce the mismatch on demand: plain `curl` requests to the dev server consistently showed the disconnected (`CONNECT`) state across many repeated calls. Curl never executes client JS, so it can only ever observe one half — the server's — of what is fundamentally a server-vs-client race. A scripted loop that only compares curl output run-to-run has no way to observe a hydration mismatch, which only exists at the moment a real browser reconciles server HTML against its own client render.

3. **Mistook the downstream symptoms for unrelated flakiness.** Because a hydration mismatch is silent/recoverable in React dev mode (it logs a warning and regenerates the client tree rather than crashing), its side effects — in-flight form/UI state resetting mid-interaction, clicks landing on now-detached DOM nodes and silently doing nothing — were initially attributed to unrelated flakiness in a broader, already-in-progress E2E test-suite debugging effort, delaying the connection back to this specific root cause.

4. **What actually confirmed and pinned the bug down** was checking the Next.js dev server's own terminal/stderr output directly, not a scripted assertion — it printed the identical stack trace from the original report, at the identical `WalletButton.tsx:45:7` location, confirming this was the live, current-tree instance of the reported bug and not a stale or already-resolved one.

## Solution

The root cause is in `web/lib/wagmi.ts`'s `e2eConfig`. Before the fix it looked like:

```ts
export const e2eConfig: Config = createConfig({
  chains: [e2eChain],
  connectors: [mock({ accounts: [E2E_DEV_ACCOUNT], features: { defaultConnected: true, reconnect: true } })],
  transports: { [e2eChain.id]: http(rpcUrl) },
});
```

No `ssr` option was set, so it defaulted to `false`. The current, fixed version (`web/lib/wagmi.ts:66-71`) adds `ssr: true`:

```ts
export const e2eConfig: Config = createConfig({
  ssr: true,
  chains: [e2eChain],
  connectors: [mock({ accounts: [E2E_DEV_ACCOUNT], features: { defaultConnected: true, reconnect: true } })],
  transports: { [e2eChain.id]: http(rpcUrl) },
});
```

The fix is accompanied by an explanatory comment already in the file (`web/lib/wagmi.ts:53-65`), quoted verbatim:

> `ssr: true` is required here, not optional: without it, `Hydrate` (wagmi's internal SSR helper) runs the mock connector's reconnect synchronously during the *server* render pass too (see @wagmi/core's `hydrate.js` — `if (!config._internal.ssr) onMount()` fires unconditionally on every render, server included). Once that reconnect resolves server-side, every later SSR response renders the connected address, while each fresh client bundle still starts disconnected pre-hydration — a server/client text mismatch on this exact button (`CONNECT` vs `0x7099…`). React then discards and regenerates the whole client tree to recover, silently resetting in-flight form/wallet state (see the WalletButton hydration mismatch this was written to fix). `ssr: true` defers reconnect to `Hydrate`'s post-commit `useEffect` instead, so first paint always matches on both sides and the wallet connects only after hydration completes.

The only file touched was `web/lib/wagmi.ts` — a single field (`ssr: true`) added to the one `createConfig` call, plus this explanatory comment.

## Why This Works

This is grounded directly in the installed package source, not just the in-file comment. `web/node_modules/wagmi/src/hydrate.ts` (mirrored in the built `web/node_modules/wagmi/dist/esm/hydrate.js`) defines the `Hydrate` component that every `WagmiProvider` mounts:

```tsx
export function Hydrate(parameters) {
  const { children, config, initialState, reconnectOnMount = true } = parameters
  const { onMount } = hydrate(config, { initialState, reconnectOnMount })

  // Hydrate for non-SSR
  if (!config._internal.ssr) onMount()

  // Hydrate for SSR
  const active = useRef(true)
  useEffect(() => {
    if (!active.current) return
    if (!config._internal.ssr) return
    onMount()
    return () => { active.current = false }
  }, [])

  return children
}
```

The line `if (!config._internal.ssr) onMount()` sits directly in the component's function body — it runs during React's render phase, not inside `useEffect`. Next.js server-renders `"use client"` components too (to produce the initial HTML that the client will hydrate against), so with `ssr` left at its default `false`, this line executes twice, independently: once while the server is producing HTML, and once during the client's very first render pass before hydration completes. `onMount()` (from `@wagmi/core`'s `hydrate()`, in `web/node_modules/wagmi/node_modules/@wagmi/core/src/hydrate.ts`) calls `reconnect(config)` whenever `reconnectOnMount` is true — which it is by default, and which is exactly what the `e2eConfig` mock connector's `defaultConnected`/`reconnect` features are designed to trigger. Because the server's render and the client's pre-hydration render each run this reconnect independently and asynchronously, whichever one happens to have resolved the mock connector's connection by the time that render's output is captured determines whether that pass renders `CONNECT` or the formatted address — and the two sides have no way to agree, since they're separate process/render contexts with independent timing.

Setting `ssr: true` changes which branch fires: the render-phase call (`if (!config._internal.ssr) onMount()`) becomes a no-op on both server and client, and the *only* place `onMount()` (and therefore `reconnect(config)`) runs is inside the `useEffect`, which itself re-checks `config._internal.ssr` before proceeding. `useEffect` bodies never run during server rendering and never run during the client's initial (pre-hydration) render — they run strictly after the commit phase, once hydration has already reconciled successfully. That guarantees the very first paint on both sides renders the same default (disconnected) state, so there is nothing for React to diff a mismatch against; the mock wallet then connects a moment later as an ordinary post-hydration client state update, which isn't subject to hydration-mismatch checking at all.

## Prevention

Any wagmi `createConfig()` used by a component tree that Next.js App Router server-renders — which, in this codebase, is every `"use client"` provider mounted from `web/app/`, since App Router always produces server HTML for the initial paint even for client components — must set `ssr: true`. Leaving it at the default `false` is safe only for connectors that never auto-connect synchronously on mount (no `reconnectOnMount`/`defaultConnected` semantics); as soon as a config's connector can resolve a connection during the initial render (as `e2eConfig`'s mock connector deliberately does, and as any real injected/injected-like connector reconnecting from storage can also do), the render-phase `onMount()` in wagmi's `Hydrate` becomes a hydration-mismatch hazard.

Concrete check for this codebase: `grep -n "createConfig(" web/lib/*.ts` — at present this surfaces `e2eConfig` in `web/lib/wagmi.ts` (the config already fixed here) and, indirectly, the Reown-managed `wagmiAdapter.wagmiConfig` used for `wagmiConfig` (the production path, which the Reown adapter configures itself). Any future wagmi config added to this file — e.g. a second mock/dev config, or a hand-rolled config that bypasses the Reown adapter — should be checked against this same `ssr` requirement before it's wired into a server-rendered provider tree.

## Related Issues

- `docs/solutions/architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md` — a different hydration-mismatch bug in the same `web/` app (a shared clock hook eagerly reading `Date.now()` during a static-export build vs. a null-then-`useEffect` pattern). Unrelated root cause and fix, but useful context for anyone mapping where hydration-timing bugs have bitten this codebase.
- `docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md` — shares the same E2E mock-connector infrastructure (`web/tests/e2e/fixtures`, the KTD6 dev-wallet setup) that `e2eConfig` belongs to, though its bug (an async query-invalidation race) is unrelated to SSR/hydration.
