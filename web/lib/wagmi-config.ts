"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { mainnet, sepolia, type Chain } from "wagmi/chains";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { CHAIN_ID } from "./constants";

const SUPPORTED_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
};

const chain = SUPPORTED_CHAINS[CHAIN_ID];
if (!chain) {
  throw new Error(
    `CHAIN_ID ${CHAIN_ID} is not supported. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
  );
}

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// wagmi and @wagmi/core export divergent Storage types; use `never` to bridge
const storage: never = createStorage({ storage: cookieStorage }) as never;

export const wagmiAdapter = new WagmiAdapter({
  storage,
  ssr: true,
  projectId,
  networks: [chain],
  transports: {
    [chain.id]: http(),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
