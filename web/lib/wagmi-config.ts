"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { CHAIN, OPTIONAL_RPC_URL } from "./config";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// wagmi and @wagmi/core export divergent Storage types; use `never` to bridge
const storage: never = createStorage({ storage: cookieStorage }) as never;

export const SUPPORTED_CHAINS = [CHAIN] as const;

export const wagmiAdapter = new WagmiAdapter({
  storage,
  ssr: true,
  projectId,
  networks: [...SUPPORTED_CHAINS],
  transports: {
    [CHAIN.id]: OPTIONAL_RPC_URL ? http(OPTIONAL_RPC_URL) : http(),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
