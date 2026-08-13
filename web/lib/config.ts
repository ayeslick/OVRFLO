import type { Address, Hash } from "viem";
import { isAddress } from "viem";

const MAINNET_CHAIN_ID = 1;
const CURRENT_PROJECTION_SCHEMA_VERSION = 1;
const CURRENT_ABI_VERSION = 1;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hash;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const SABLIER_LOCKUP_ADDRESS =
  "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9" as const;

const env = {
  profile: process.env.NEXT_PUBLIC_RUNTIME_PROFILE,
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  factory: process.env.NEXT_PUBLIC_OVRFLO_FACTORY,
  factoryDeploymentBlock: process.env.NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK,
  factoryDeploymentBlockHash: process.env.NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH,
  ovrflo: process.env.NEXT_PUBLIC_OVRFLO_ADDRESS,
  lending: process.env.NEXT_PUBLIC_OVRFLO_LENDING,
  lendingDeploymentBlock: process.env.NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK,
  lendingDeploymentBlockHash: process.env.NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH,
  projectionSchemaVersion: process.env.NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION,
  abiVersion: process.env.NEXT_PUBLIC_ABI_VERSION,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  rpcFallbackUrls: process.env.NEXT_PUBLIC_RPC_FALLBACK_URLS,
  historicalRpcUrl: process.env.NEXT_PUBLIC_HISTORICAL_RPC_URL,
  reownProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
  vercelEnv: process.env.VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
  deployableBuild: process.env.OVRFLO_DEPLOYABLE_BUILD,
};

export type RuntimeProfile = "local" | "production";
export type FactoryDeployment = {
  address: Address;
  blockNumber: bigint;
  blockHash: Hash;
  ovrflo: Address;
  lending: Address;
  lendingBlockNumber: bigint;
  lendingBlockHash: Hash;
  projectionSchemaVersion: number;
  abiVersion: number;
};

function parseProfile(): RuntimeProfile {
  const raw = env.profile ?? (env.nodeEnv === "production" ? "production" : "local");
  if (raw !== "local" && raw !== "production") {
    throw new Error("NEXT_PUBLIC_RUNTIME_PROFILE must be local or production");
  }
  if (
    raw === "local" &&
    (env.vercelEnv === "production" || env.deployableBuild === "1")
  ) {
    throw new Error("The local runtime profile cannot activate in a deployable production build");
  }
  return raw;
}

function required(raw: string | undefined, name: string) {
  if (!raw) throw new Error(`${name} is required in the production profile`);
  return raw;
}

function parseChainId(raw: string | undefined, profile: RuntimeProfile): typeof MAINNET_CHAIN_ID {
  const value = profile === "production" ? required(raw, "NEXT_PUBLIC_CHAIN_ID") : (raw ?? "1");
  if (value !== "1") {
    throw new Error("OVRFLO web requires chain id 1, including local mainnet forks");
  }
  return MAINNET_CHAIN_ID;
}

function parseAddress(
  raw: string | undefined,
  name: string,
  profile: RuntimeProfile,
): Address {
  const value =
    profile === "production" ? required(raw, name) : (raw || ZERO_ADDRESS);
  if (!isAddress(value)) throw new Error(`${name} must be a valid address`);
  if (profile === "production" && value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${name} must not be the zero address in production`);
  }
  return value;
}

function parseBlockNumber(
  raw: string | undefined,
  name: string,
  profile: RuntimeProfile,
): bigint {
  if (profile === "local" && raw === undefined) return 0n;
  const value = required(raw, name);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative base-10 block number`);
  }
  return BigInt(value);
}

function parseHash(
  raw: string | undefined,
  name: string,
  profile: RuntimeProfile,
): Hash {
  if (profile === "local" && raw === undefined) return ZERO_HASH;
  const value = required(raw, name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex hash`);
  }
  return value as Hash;
}

function parseVersion(
  raw: string | undefined,
  name: string,
  expected: number,
  profile: RuntimeProfile,
) {
  if (profile === "local" && raw === undefined) return expected;
  const value = required(raw, name);
  if (value !== String(expected)) {
    throw new Error(`${name} must be the supported version ${expected}`);
  }
  return expected;
}

function parseUrl(
  raw: string,
  name: string,
  profile: RuntimeProfile,
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (url.hostname === "alchemyapi.io" || url.hostname.endsWith(".alchemyapi.io")) {
    throw new Error(`${name} uses the deprecated alchemyapi.io host`);
  }
  if (profile === "production") {
    const localHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname.endsWith(".localhost");
    if (url.protocol !== "https:" || localHost) {
      throw new Error(`${name} cannot use a local or non-HTTPS origin in production`);
    }
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString();
}

function parseRpcUrls(profile: RuntimeProfile) {
  const primaryRaw =
    profile === "production"
      ? required(env.rpcUrl, "NEXT_PUBLIC_RPC_URL")
      : (env.rpcUrl ?? "http://127.0.0.1:8545");
  const fallbacks = (env.rpcFallbackUrls ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    parseUrl(primaryRaw, "NEXT_PUBLIC_RPC_URL", profile),
    ...fallbacks.map((value, index) =>
      parseUrl(value, `NEXT_PUBLIC_RPC_FALLBACK_URLS[${index}]`, profile),
    ),
  ];
}

function parseReownProjectId(profile: RuntimeProfile) {
  const value =
    profile === "production"
      ? required(env.reownProjectId, "NEXT_PUBLIC_REOWN_PROJECT_ID")
      : (env.reownProjectId || "00000000000000000000000000000000");
  if (
    profile === "production" &&
    (!/^[0-9a-fA-F]{32}$/.test(value) || value === "00000000000000000000000000000000")
  ) {
    throw new Error("NEXT_PUBLIC_REOWN_PROJECT_ID must be a non-placeholder 32-character hex id");
  }
  return value;
}

export const runtimeProfile = parseProfile();
export const chainId = parseChainId(env.chainId, runtimeProfile);
export const factoryAddress = parseAddress(
  env.factory,
  "NEXT_PUBLIC_OVRFLO_FACTORY",
  runtimeProfile,
);
export const factoryDeployment: FactoryDeployment = {
  address: factoryAddress,
  blockNumber: parseBlockNumber(
    env.factoryDeploymentBlock,
    "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK",
    runtimeProfile,
  ),
  blockHash: parseHash(
    env.factoryDeploymentBlockHash,
    "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH",
    runtimeProfile,
  ),
  ovrflo: parseAddress(env.ovrflo, "NEXT_PUBLIC_OVRFLO_ADDRESS", runtimeProfile),
  lending: parseAddress(env.lending, "NEXT_PUBLIC_OVRFLO_LENDING", runtimeProfile),
  lendingBlockNumber: parseBlockNumber(
    env.lendingDeploymentBlock,
    "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK",
    runtimeProfile,
  ),
  lendingBlockHash: parseHash(
    env.lendingDeploymentBlockHash,
    "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH",
    runtimeProfile,
  ),
  projectionSchemaVersion: parseVersion(
    env.projectionSchemaVersion,
    "NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION",
    CURRENT_PROJECTION_SCHEMA_VERSION,
    runtimeProfile,
  ),
  abiVersion: parseVersion(
    env.abiVersion,
    "NEXT_PUBLIC_ABI_VERSION",
    CURRENT_ABI_VERSION,
    runtimeProfile,
  ),
};
export const rpcUrls = parseRpcUrls(runtimeProfile);
const primaryRpcUrl = rpcUrls[0];
if (!primaryRpcUrl) throw new Error("NEXT_PUBLIC_RPC_URL is required");
export const rpcUrl = primaryRpcUrl;
export const historicalRpcUrl = parseUrl(
  runtimeProfile === "production"
    ? required(env.historicalRpcUrl, "NEXT_PUBLIC_HISTORICAL_RPC_URL")
    : (env.historicalRpcUrl ?? rpcUrl),
  "NEXT_PUBLIC_HISTORICAL_RPC_URL",
  runtimeProfile,
);
export const reownProjectId = parseReownProjectId(runtimeProfile);

export function isConfiguredAddress(address: Address | null | undefined) {
  return Boolean(address && address.toLowerCase() !== ZERO_ADDRESS);
}
