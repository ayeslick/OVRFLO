import { mainnet as appKitMainnet, sepolia as appKitSepolia } from "@reown/appkit/networks";
import { mainnet as wagmiMainnet, sepolia as wagmiSepolia, type Chain } from "wagmi/chains";
import { CHAIN_ID } from "./constants";

const SUPPORTED_NETWORKS = {
  [wagmiMainnet.id]: {
    wagmi: wagmiMainnet,
    appKit: appKitMainnet,
  },
  [wagmiSepolia.id]: {
    wagmi: wagmiSepolia,
    appKit: appKitSepolia,
  },
} as const satisfies Record<number, { wagmi: Chain; appKit: unknown }>;

const resolvedNetwork = SUPPORTED_NETWORKS[CHAIN_ID as keyof typeof SUPPORTED_NETWORKS];

if (!resolvedNetwork) {
  throw new Error(
    `CHAIN_ID ${CHAIN_ID} is not supported. Supported: ${Object.keys(SUPPORTED_NETWORKS).join(", ")}`
  );
}

export const resolvedWagmiChain = resolvedNetwork.wagmi;
export const resolvedAppKitNetwork = resolvedNetwork.appKit;
