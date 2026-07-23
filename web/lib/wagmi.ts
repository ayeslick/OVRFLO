"use client";

import { QueryClient } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { createConfig, http } from "wagmi";
import { reownProjectId, rpcUrl } from "./config";

const networks = [mainnet];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: reownProjectId,
  transports: {
    [mainnet.id]: http(rpcUrl),
  },
});

export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(rpcUrl),
  },
});

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
