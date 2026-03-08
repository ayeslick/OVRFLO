"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
<<<<<<< HEAD
import { RPC_URL } from "./constants";
import { resolvedWagmiChain } from "./chain-config";
=======
import { SUPPORTED_CHAIN } from "./launch-config";
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// wagmi and @wagmi/core export divergent Storage types; use `never` to bridge
const storage: never = createStorage({ storage: cookieStorage }) as never;

export const SUPPORTED_CHAINS = [SUPPORTED_CHAIN] as const;

export const wagmiAdapter = new WagmiAdapter({
  storage,
  ssr: true,
  projectId,
<<<<<<< HEAD
  networks: [resolvedWagmiChain],
  transports: {
    [resolvedWagmiChain.id]: http(RPC_URL),
=======
  networks: [...SUPPORTED_CHAINS],
  transports: {
    [SUPPORTED_CHAIN.id]: http(),
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
