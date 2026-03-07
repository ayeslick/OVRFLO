export const SABLIER_LOCKUP = "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9" as const;

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function parseFactoryAddresses(
  factoriesEnv: string | undefined,
  factoryEnv: string | undefined
): readonly `0x${string}`[] {
  const raw = factoriesEnv ?? factoryEnv;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_OVRFLO_FACTORIES or NEXT_PUBLIC_OVRFLO_FACTORY must be set. Add it to .env.local."
    );
  }

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw new Error(
      "No OVRFLO factory addresses were provided. Set NEXT_PUBLIC_OVRFLO_FACTORIES or NEXT_PUBLIC_OVRFLO_FACTORY."
    );
  }

  if (!parsed.every(isAddress)) {
    throw new Error(
      `Invalid factory address list: "${raw}". Use comma-separated 0x addresses.`
    );
  }

  return parsed;
}

export const OVRFLO_FACTORIES = parseFactoryAddresses(
  process.env.NEXT_PUBLIC_OVRFLO_FACTORIES,
  process.env.NEXT_PUBLIC_OVRFLO_FACTORY
);
export const OVRFLO_FACTORY = OVRFLO_FACTORIES[0];

const _chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "1");
if (!Number.isFinite(_chainId) || _chainId <= 0) {
  throw new Error(
    `NEXT_PUBLIC_CHAIN_ID is invalid ("${process.env.NEXT_PUBLIC_CHAIN_ID}"). Must be a positive integer.`
  );
}
export const CHAIN_ID = _chainId;

const _rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
if (!_rpcUrl) {
  throw new Error("NEXT_PUBLIC_RPC_URL is not set. Add it to .env.local.");
}
export const RPC_URL = _rpcUrl;

export const SABLIER_ENVIO_URL =
  "https://indexer.hyperindex.xyz/53b7e25/v1/graphql" as const;
