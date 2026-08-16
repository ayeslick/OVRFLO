import type { Hash, PublicClient } from "viem";

/** Snapshot identity: height plus the hash the caller captured from this provider. */
export type BlockPin = {
  blockNumber: bigint;
  blockHash: Hash;
};

export type PinVerifyResult =
  | { ok: true }
  | { ok: false; code: "transport" | "invalid"; message: string };

export type PinClient = Pick<PublicClient, "getBlock">;

export function sameBlockHash(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Primary EIP-1898 selector. Never pair with `blockNumber` on the same call.
 * Omitting `requireCanonical` lets a node serve a reorged-out block.
 */
export function hashPin(pin: BlockPin) {
  return { blockHash: pin.blockHash, requireCanonical: true as const };
}

/**
 * Number-pin fallback after the 008 probe. Confirm the node still serves
 * `pin.blockHash` at `pin.blockNumber`. The hash-pin happy path does not
 * call this — a replacement block at the same height is discarded.
 */
export async function verifyPinHash(
  client: PinClient,
  pin: BlockPin,
): Promise<PinVerifyResult> {
  let hash: Hash | null;
  try {
    const block = await client.getBlock({ blockNumber: pin.blockNumber });
    hash = block.hash;
  } catch (error) {
    return {
      ok: false,
      code: "transport",
      message: error instanceof Error ? error.message : "getBlock failed",
    };
  }
  if (!hash) {
    return {
      ok: false,
      code: "invalid",
      message: `Block ${pin.blockNumber.toString()} has no hash`,
    };
  }
  if (!sameBlockHash(hash, pin.blockHash)) {
    return {
      ok: false,
      code: "invalid",
      message: `pin hash mismatch: expected ${pin.blockHash}, got ${hash}`,
    };
  }
  return { ok: true };
}
