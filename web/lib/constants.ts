import { isAddress } from "viem";
import {
  MAINNET_DEPENDENCIES,
  PUBLIC_ENV_REFERENCE,
  SUPPORTED_CHAIN,
  SUPPORTED_CHAIN_LABEL,
} from "./launch-config";

export const CHAIN_ID = SUPPORTED_CHAIN.id;
export const CHAIN_NAME = SUPPORTED_CHAIN_LABEL;
export const PENDLE_ORACLE = MAINNET_DEPENDENCIES.pendleOracle;
export const SABLIER_LOCKUP = MAINNET_DEPENDENCIES.sablierLockup;
export const SABLIER_ENVIO_URL = MAINNET_DEPENDENCIES.sablierIndexerUrl;

export function parseFactoryAddresses(
  factoriesEnv: string | undefined,
  factoryEnv: string | undefined
): readonly `0x${string}`[] {
  const raw = factoriesEnv ?? factoryEnv;
  if (!raw) {
    throw new Error(
      `${PUBLIC_ENV_REFERENCE.factory} is not set. Copy web/.env.example to .env.local and point it at the deployed mainnet factory. To provide multiple factories intentionally, use ${PUBLIC_ENV_REFERENCE.factories}.`
    );
  }

  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw new Error(
      `No OVRFLO factory addresses were provided. Set ${PUBLIC_ENV_REFERENCE.factory} or ${PUBLIC_ENV_REFERENCE.factories}.`
    );
  }

  if (!parsed.every((value): value is `0x${string}` => isAddress(value))) {
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

const rawChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
if (!rawChainId) {
  throw new Error(
    `${PUBLIC_ENV_REFERENCE.chainId} is not set. OVRFLO web currently supports ${CHAIN_NAME} only, so set ${PUBLIC_ENV_REFERENCE.chainId}=${CHAIN_ID}.`
  );
}

const _chainId = Number(rawChainId);
if (!Number.isInteger(_chainId) || _chainId <= 0) {
  throw new Error(
    `${PUBLIC_ENV_REFERENCE.chainId} is invalid ("${rawChainId}"). Must be a positive integer.`
  );
}
if (_chainId !== CHAIN_ID) {
  throw new Error(
    `OVRFLO web currently supports ${CHAIN_NAME} only because the contract and indexer dependencies are pinned to mainnet. Set ${PUBLIC_ENV_REFERENCE.chainId}=${CHAIN_ID}.`
  );
}
