import type { Address } from "viem";
import { isAddress } from "viem";

export const MAINNET_CHAIN_ID = 1;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const SABLIER_LOCKUP_ADDRESS =
  "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9" as const;

const env = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  factory: process.env.NEXT_PUBLIC_OVRFLO_FACTORY,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  reownProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
  ponderUrl: process.env.NEXT_PUBLIC_PONDER_URL,
  sablierIndexerUrl: process.env.NEXT_PUBLIC_SABLIER_INDEXER_URL,
  e2e: process.env.NEXT_PUBLIC_E2E,
};

function parseChainId(raw = "1") {
  const parsed = Number.parseInt(raw, 10);
  if (parsed !== MAINNET_CHAIN_ID) {
    throw new Error("OVRFLO web requires chain id 1, including local mainnet forks");
  }
  return parsed;
}

function parseAddress(raw: string | undefined, name: string): Address {
  if (!raw || !isAddress(raw)) {
    throw new Error(`${name} must be a valid address`);
  }
  return raw;
}

function optionalUrl(raw: string | undefined) {
  if (!raw) return undefined;
  return new URL(raw).toString();
}

export const chainId = parseChainId(env.chainId);
export const factoryAddress = parseAddress(
  env.factory ?? ZERO_ADDRESS,
  "NEXT_PUBLIC_OVRFLO_FACTORY",
);
export const rpcUrl = optionalUrl(env.rpcUrl);
export const reownProjectId = env.reownProjectId || "00000000000000000000000000000000";
export const ponderUrl = optionalUrl(env.ponderUrl ?? env.sablierIndexerUrl);

// Ticket 05 / KTD6: E2E-only escape hatch. When set, `lib/wagmi.ts` swaps in
// a wagmi `mock` connector (auto-connected as Anvil's well-known account #1)
// instead of the real Reown AppKit config, so Playwright never has to drive
// the actual Connect-Wallet/WalletConnect UI. Must be set before `next dev`
// starts (NEXT_PUBLIC_* is inlined at build/dev-server-start time) — see
// tests/e2e/README.md.
export const isE2E = env.e2e === "1";

export function isConfiguredAddress(address: Address | null | undefined) {
  return Boolean(address && address !== ZERO_ADDRESS);
}
