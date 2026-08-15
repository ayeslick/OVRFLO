import type { Address } from "viem";

/**
 * AE6 full-value arrange: close must burn. A returned NFT fails the arrange.
 */
export function requireStreamBurnedAfterClose(
  owner: Address | null,
  streamId: bigint,
): void {
  if (owner !== null) {
    throw new Error(
      `AE6 full-value arrange: stream ${streamId.toString()} returned to ${owner}; expected burn`,
    );
  }
}
