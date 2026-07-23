"use client";

import { QueryClient } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { http, type Config } from "wagmi";
import { reownProjectId, rpcUrl } from "./config";

const networks = [mainnet];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: reownProjectId,
  transports: {
    [mainnet.id]: http(rpcUrl),
  },
});

// WagmiProvider must share the exact config AppKit connects against, or wallet
// connections made through the modal never propagate to the app's wagmi hooks.
// The cast bridges the duplicate @wagmi/core versions (the Reown adapter pins a
// different patch than wagmi bundles); the runtime object is the one AppKit drives.
export const wagmiConfig = wagmiAdapter.wagmiConfig as unknown as Config;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

let appKitCreated = false;

export function ensureAppKit() {
  if (appKitCreated) return;
  createAppKit({
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
