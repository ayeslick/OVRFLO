import { isAddress } from "viem";
import { mainnet } from "wagmi/chains";

export const ENV = {
  chainId: "NEXT_PUBLIC_CHAIN_ID",
  factory: "NEXT_PUBLIC_OVRFLO_FACTORY",
  reownProjectId: "NEXT_PUBLIC_REOWN_PROJECT_ID",
  rpcUrl: "NEXT_PUBLIC_RPC_URL",
  priceApiUrl: "NEXT_PUBLIC_PRICE_API_URL",
} as const;

export const CHAIN = mainnet;
export const CHAIN_ID = CHAIN.id;
export const CHAIN_NAME = "Ethereum Mainnet" as const;

// Hardcoded in OVRFLO.sol; identical on any mainnet fork (local anvil, dev, mainnet).
export const PROTOCOL_DEPS = {
  pendleOracle: "0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2",
  sablierLockup: "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9",
} as const;

export const PENDLE_ORACLE = PROTOCOL_DEPS.pendleOracle;
export const SABLIER_LOCKUP = PROTOCOL_DEPS.sablierLockup;

export const SABLIER_ENVIO_URL =
  "https://indexer.hyperindex.xyz/53b7e25/v1/graphql" as const;

function requireEnv(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `${name} is not set. Copy web/.env.example to .env.local and fill in the required values.`
    );
  }
  return value.trim();
}

function parseFactory(raw: string | undefined): `0x${string}` {
  const trimmed = requireEnv(ENV.factory, raw);
  if (!isAddress(trimmed)) {
    throw new Error(
      `${ENV.factory} is invalid ("${trimmed}"). Must be a single 0x address.`
    );
  }
  return trimmed;
}

function parseChainId(raw: string | undefined): number {
  const trimmed = requireEnv(ENV.chainId, raw);
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${ENV.chainId} is invalid ("${trimmed}"). Must be a positive integer.`
    );
  }
  if (parsed !== CHAIN_ID) {
    throw new Error(
      `${ENV.chainId}=${trimmed} is not supported. OVRFLO contracts hardcode mainnet-only protocol dependencies (Sablier, Pendle oracle); local/dev must run against an anvil fork of mainnet with ${ENV.chainId}=${CHAIN_ID}.`
    );
  }
  return parsed;
}

export const OVRFLO_FACTORY = parseFactory(process.env.NEXT_PUBLIC_OVRFLO_FACTORY);

// Validated for side effect (throws on bad input); value equals CHAIN_ID by construction.
parseChainId(process.env.NEXT_PUBLIC_CHAIN_ID);

export const OPTIONAL_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined;

export const PRICE_API_URL =
  process.env.NEXT_PUBLIC_PRICE_API_URL?.trim() ||
  "https://api.coingecko.com/api/v3";
