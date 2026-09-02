import { policy } from "@morpho-org/viem-dlc/actions";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type AbiFunction,
  type Hex,
  type PublicClient,
} from "viem";
import { ovrfloStreamLensAbi } from "@/lib/generated/lens-bytecode";
import type { BlockPin } from "./pin";

/**
 * Creation bytecode for a view that returns `block.number`.
 * Compiled solc 0.8.36, optimizer 200, via_ir true. A hash pin that the
 * node ignored returns the latest height instead of the pinned height.
 */
export const PIN_PROBE_CREATION_BYTECODE =
  "0x608080604052346013576073908160188239f35b5f80fdfe60808060405260043610156011575f80fd5b5f3560e01c6357e871e7146023575f80fd5b346039575f366003190112603957602090438152f35b5f80fdfea264697066735822122003f4aee5f1aee2f6514abf2f5c03ef52d0b2885293f54f15b186faba470212bb64736f6c63430008240033" as Hex;

export const pinProbeAbi = [
  {
    type: "function",
    name: "blockNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Distance below latest so the probe is not block-independent. */
export const PIN_PROBE_LAG_BLOCKS = 64n;

export type PinProbeClient = Pick<PublicClient, "call" | "getBlockNumber" | "getBlock">;

export type PinProbeResult = {
  supported: boolean;
  returnedBlockNumber?: bigint;
  error?: string;
};

export function pastPinError(latest: bigint, pin: BlockPin): string | undefined {
  if (pin.blockNumber >= latest) {
    return `pin ${pin.blockNumber.toString()} is not a past block (latest ${latest.toString()})`;
  }
  return undefined;
}

/**
 * Deployless `code` + calldata pinned with EIP-1898 `{blockHash, requireCanonical}`.
 * Supported only when the returned `block.number` equals the pinned height.
 */
export async function probeHashPin(
  client: PinProbeClient,
  pin: BlockPin,
): Promise<PinProbeResult> {
  try {
    const { data } = await client.call({
      code: PIN_PROBE_CREATION_BYTECODE,
      data: encodeFunctionData({ abi: pinProbeAbi, functionName: "blockNumber" }),
      blockHash: pin.blockHash,
      requireCanonical: true,
    });
    if (!data || data === "0x") {
      return { supported: false, error: "probe returned empty data" };
    }
    const returnedBlockNumber = decodeFunctionResult({
      abi: pinProbeAbi,
      functionName: "blockNumber",
      data,
    });
    return {
      supported: returnedBlockNumber === pin.blockNumber,
      returnedBlockNumber,
    };
  } catch (error) {
    return {
      supported: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function selectPastPin(
  client: PinProbeClient,
): Promise<{ pin: BlockPin } | { skip: string }> {
  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
  } catch (error) {
    return {
      skip: error instanceof Error ? error.message : "eth_blockNumber failed",
    };
  }
  if (latest < 2n) {
    return { skip: `head ${latest.toString()} has no past block to pin` };
  }
  const lag = latest > PIN_PROBE_LAG_BLOCKS ? PIN_PROBE_LAG_BLOCKS : latest - 1n;
  const blockNumber = latest - lag;
  let hash: `0x${string}` | null;
  try {
    const block = await client.getBlock({ blockNumber });
    hash = block.hash;
  } catch (error) {
    return {
      skip: error instanceof Error ? error.message : `getBlock(${blockNumber.toString()}) failed`,
    };
  }
  if (!hash) {
    return { skip: `block ${blockNumber.toString()} has no hash` };
  }
  const pin = { blockNumber, blockHash: hash };
  const notPast = pastPinError(latest, pin);
  if (notPast) return { skip: notPast };
  return { pin };
}

export const DEFAULT_DEPLOYLESS_PROVIDER_KEY = "public-read";
export const DEPLOYLESS_PROBE_TIMEOUT_MS = 5_000;

export type DeploylessLensId = "streamsOfOwner" | "streamsOfOwnerIn";
export type DeploylessCapabilityId = DeploylessLensId | "hash-pin";

const LENS_POLICY_BATCH = {
  batchSize: 1 << 15,
  gas: { constant: 50_000, linear: 30_000, quadratic: 0 },
} as const;

const capabilityCache = new Map<string, boolean>();

export function capabilityCacheKey(providerKey: string, id: DeploylessCapabilityId) {
  return `${providerKey}::${id}`;
}

export function resetDeploylessCapabilityCache() {
  capabilityCache.clear();
}

export function getDeploylessCapability(
  providerKey: string,
  id: DeploylessCapabilityId,
): boolean | undefined {
  return capabilityCache.get(capabilityCacheKey(providerKey, id));
}

export function setDeploylessCapability(
  providerKey: string,
  id: DeploylessCapabilityId,
  supported: boolean,
) {
  capabilityCache.set(capabilityCacheKey(providerKey, id), supported);
}

export function invalidateDeploylessCapability(providerKey: string, id?: DeploylessCapabilityId) {
  if (id) {
    capabilityCache.delete(capabilityCacheKey(providerKey, id));
    return;
  }
  const prefix = `${providerKey}::`;
  for (const key of [...capabilityCache.keys()]) {
    if (key.startsWith(prefix)) capabilityCache.delete(key);
  }
}

export function lensPolicyAbi(lens: DeploylessLensId): AbiFunction {
  const entry = ovrfloStreamLensAbi.find((item) => item.type === "function" && item.name === lens);
  if (!entry || entry.type !== "function") {
    throw new Error(`Missing lens ABI ${lens}`);
  }
  return entry as AbiFunction;
}

export function lensPolicyOverride(lens: DeploylessLensId) {
  return policy({
    abi: lensPolicyAbi(lens),
    batch: LENS_POLICY_BATCH,
  });
}

export function isDeploylessCapabilityMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /state.?override|not supported|invalid params|method not found|timed out|timeout/i.test(
    message,
  );
}

function withTimeout<T>(timeoutMs: number, run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe timed out")), timeoutMs);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type LensPolicyClient = Pick<PublicClient, "call">;

/**
 * Harmless deployless pin call plus real viem-dlc `policy(...)` state override.
 * Caches only the supported boolean — never the returned height as chain authority.
 */
export async function probeLensPolicy(
  client: LensPolicyClient,
  pin: BlockPin,
  lens: DeploylessLensId,
  options?: { timeoutMs?: number },
): Promise<PinProbeResult> {
  const timeoutMs = options?.timeoutMs ?? DEPLOYLESS_PROBE_TIMEOUT_MS;
  try {
    const { data } = await withTimeout(timeoutMs, () =>
      client.call({
        code: PIN_PROBE_CREATION_BYTECODE,
        data: encodeFunctionData({ abi: pinProbeAbi, functionName: "blockNumber" }),
        stateOverride: [lensPolicyOverride(lens)],
        blockHash: pin.blockHash,
        requireCanonical: true,
      }),
    );
    if (!data || data === "0x") {
      return { supported: false, error: "probe returned empty data" };
    }
    try {
      const returnedBlockNumber = decodeFunctionResult({
        abi: pinProbeAbi,
        functionName: "blockNumber",
        data,
      });
      return {
        supported: returnedBlockNumber === pin.blockNumber,
        returnedBlockNumber,
      };
    } catch (error) {
      return {
        supported: false,
        error: error instanceof Error ? error.message : "malformed probe result",
      };
    }
  } catch (error) {
    return {
      supported: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureDeploylessCapability(
  client: LensPolicyClient,
  pin: BlockPin,
  providerKey: string,
  id: DeploylessCapabilityId,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const cached = getDeploylessCapability(providerKey, id);
  if (cached !== undefined) return cached;
  const result =
    id === "hash-pin"
      ? await probeHashPin(client as PinProbeClient, pin)
      : await probeLensPolicy(client, pin, id, options);
  setDeploylessCapability(providerKey, id, result.supported);
  return result.supported;
}
