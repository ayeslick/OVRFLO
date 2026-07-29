"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { http, type Config } from "wagmi";
import { reownProjectId, rpcUrl } from "./config";

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
  // Pinned by tests/lib/wagmi-config.test.ts — nothing else covers this file.
  ssr: true,
  transports: {
    [mainnet.id]: http(rpcUrl),
  },
});

// WagmiProvider must share the exact config AppKit connects against, or wallet
// connections made through the modal never propagate to the app's wagmi hooks.
// The cast bridges the duplicate @wagmi/core versions (the Reown adapter pins a
// different patch than wagmi bundles); the runtime object is the one AppKit drives.
export const wagmiConfig = wagmiAdapter.wagmiConfig as unknown as Config;

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
