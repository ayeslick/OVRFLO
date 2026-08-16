import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  type PublicClient,
} from "viem";
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
