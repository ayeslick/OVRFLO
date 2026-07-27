"use client";

import { QueryClient } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { mainnet as viemMainnet } from "wagmi/chains";
import { createConfig, http, type Config } from "wagmi";
import { mock } from "wagmi/connectors";
import type { Address } from "viem";
import { isE2E, reownProjectId, rpcUrl } from "./config";

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

// Ticket 05 / KTD6: Anvil's well-known account #1 — one of ten dev-mnemonic
// addresses Anvil derives and unlocks internally on every local fork. It is
// never funded on any real chain and never associated with a private key
// anywhere in this codebase: the wagmi `mock` connector below only ever
// forwards requests (eth_sendTransaction, personal_sign, ...) as raw JSON-RPC
// to the chain the app is pointed at, and Anvil signs for its own default
// accounts internally. This is also `script/seed-local.sh`'s `$DEV_WALLET`
// default — keep the two in lockstep.
export const E2E_DEV_ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// The mock connector's provider reads `chain.rpcUrls.default.http[0]`
// directly (see @wagmi/core's connectors/mock.ts) rather than the
// `transports` map below, so both must point at the local fork.
const e2eChain = {
  ...viemMainnet,
  rpcUrls: { default: { http: [rpcUrl ?? "http://127.0.0.1:8545"] } },
};

// E2E-only config: no Reown AppKit (avoids WalletConnect relay/cloud calls a
// sandboxed or offline CI runner can't make), `defaultConnected`+`reconnect`
// so wagmi's own reconnect-on-mount (`WagmiProvider`'s default
// `reconnectOnMount`) authenticates the dev wallet before any scenario runs —
// no Connect-Wallet click ever exercised, matching KTD6.
export const e2eConfig: Config = createConfig({
  chains: [e2eChain],
  connectors: [mock({ accounts: [E2E_DEV_ACCOUNT], features: { defaultConnected: true, reconnect: true } })],
  transports: { [e2eChain.id]: http(rpcUrl) },
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
  // E2E never opens the AppKit modal (KTD6), so skip initializing it entirely —
  // avoids WalletConnect relay/cloud network calls that a sandboxed or
  // offline E2E runner may not be able to make.
  if (isE2E || appKitCreated) return;
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
