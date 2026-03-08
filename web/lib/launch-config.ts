import { mainnet } from "wagmi/chains";

export const SUPPORTED_CHAIN = mainnet;
export const SUPPORTED_APPKIT_NETWORK = SUPPORTED_CHAIN;
export const SUPPORTED_CHAIN_LABEL = "Ethereum Mainnet" as const;

export const OPTIONAL_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined;

export const MAINNET_DEPENDENCIES = {
  pendleOracle: "0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2",
  sablierLockup: "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9",
  sablierIndexerUrl: "https://indexer.hyperindex.xyz/53b7e25/v1/graphql",
} as const;

export const PUBLIC_ENV_REFERENCE = {
  chainId: "NEXT_PUBLIC_CHAIN_ID",
  factory: "NEXT_PUBLIC_OVRFLO_FACTORY",
  factories: "NEXT_PUBLIC_OVRFLO_FACTORIES",
  reownProjectId: "NEXT_PUBLIC_REOWN_PROJECT_ID",
  rpcUrl: "NEXT_PUBLIC_RPC_URL",
} as const;