"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { RPC_URL } from "./constants";
import { resolvedWagmiChain } from "./chain-config";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// wagmi and @wagmi/core export divergent Storage types; use `never` to bridge
const storage: never = createStorage({ storage: cookieStorage }) as never;

export const wagmiAdapter = new WagmiAdapter({
  storage,
  ssr: true,
  projectId,
  networks: [resolvedWagmiChain],
  transports: {
    [resolvedWagmiChain.id]: http(RPC_URL),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
