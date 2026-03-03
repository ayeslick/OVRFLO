"use client";

import { cookieStorage, createStorage, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }) as any,
  ssr: true,
  projectId,
  networks: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
