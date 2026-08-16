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

export type PinMode = "hash" | "number";

/**
 * Primary EIP-1898 selector. Never pair with `blockNumber` on the same call.
 * Omitting `requireCanonical` lets a node serve a reorged-out block.
 */
export function hashPin(pin: BlockPin) {
  return { blockHash: pin.blockHash, requireCanonical: true as const };
}

export function hostIsLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

/** Hash pin only when every configured URL is loopback. Hosted URLs use number+verify. */
export function pinModeForRpcUrls(urls: readonly string[]): PinMode {
  if (urls.length === 0) return "number";
  return urls.every(hostIsLoopback) ? "hash" : "number";
}

/**
 * Number-pin fallback after the 008 probe. Pair with `verifyPinHash`
 * before accepting a page. Never send hash and number on the same call.
 */
export function numberPin(pin: BlockPin) {
  return { blockNumber: pin.blockNumber };
}

export function callPin(pin: BlockPin, mode: PinMode) {
  return mode === "number" ? numberPin(pin) : hashPin(pin);
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
