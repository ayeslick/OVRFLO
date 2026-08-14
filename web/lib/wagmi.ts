"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { http, type Config } from "wagmi";
import { reownProjectId, rpcUrls } from "./config";
import { createOrderedReadTransport } from "./rpc";

// Production wallet stack only. The E2E runtime never imports this module —
// constructing `WagmiAdapter` performs Reown/WalletConnect setup at module
// scope, which a sandboxed test runner cannot always reach. See
// components/WalletRuntime.tsx for the seam.

const networks = [mainnet];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: reownProjectId,
  // Not optional. WagmiAdapter spreads its params straight into `createConfig`,
  // so this reaches wagmi. Without it, wagmi's `Hydrate` calls `onMount()` in
  // the *render body* rather than in an effect, and `reconnect()` does a
  // synchronous `config.setState({ status: 'reconnecting' | 'connecting' })`
  // before its first await — a store write during render, feeding the exact
  // field `WalletButton` renders on (`connection.status`). That runs during the
  // build-time prerender pass too: `output: "export"` removes the runtime
  // server, not the render pass that produces the HTML. Reown's own docs pass
  // this flag; it defers reconnect to Hydrate's post-commit effect.
  // Pinned by tests/lib/wagmi-config.test.tsx — nothing else covers this file.
  ssr: true,
  transports: {
    [mainnet.id]: createOrderedReadTransport(rpcUrls.map((url) => http(url))),
  },
});

// WagmiProvider must share the exact config AppKit connects against, or wallet
// connections made through the modal never propagate to the app's wagmi hooks.
//
// This is a plain typed assignment, not a cast, and that is load-bearing. The
// adapter builds this object with its own @wagmi/core; `WagmiProvider` consumes
// it with wagmi's. When those resolve to different versions, `Config` is two
// nominally distinct types and the assignment only compiles behind an
// `as unknown as` — which also suppresses any *real* incompatibility between
// the two versions. The `overrides` block in package.json collapses both
// @wagmi/core and @wagmi/connectors to one copy, so the compiler can check this
// edge for real. Keep it uncast: a future version skew must fail the build here
// rather than be absorbed silently.
// Guarded by scripts/check-wagmi-dedupe.mjs (npm run lint:deps).
export const wagmiConfig: Config = wagmiAdapter.wagmiConfig;

let appKitCreated = false;

export function ensureAppKit() {
  if (appKitCreated) return;
  createAppKit({
    // Inline literal, not the shared `networks` const: createAppKit's parameter
    // is a non-empty tuple `[AppKitNetwork, ...AppKitNetwork[]]`, and a `const`
    // array widens to `AppKitNetwork[]`, which does not satisfy it.
    adapters: [wagmiAdapter],
    networks: [mainnet],
    projectId: reownProjectId,
    metadata: {
      name: "OVRFLO",
      description: "Self-repaying loans against Sablier streams.",
      url: typeof window === "undefined" ? "https://overflow.finance" : window.location.origin,
      icons: ["https://overflow.finance/images/logo.jpeg"],
    },
  });
  appKitCreated = true;
}
