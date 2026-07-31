import type { Address } from "viem";
import { ovrfloLendingAbi } from "../abis";
import {
  fetchBorrowDemand,
  fetchHeldStreamIds,
} from "../ponder";

/**
 * Temporary U9-only access to the two legacy discovery surfaces.
 *
 * Live components and execution code must never import this module. Ticket 10
 * removes the gather branch after parity is accepted; ticket 11 removes the
 * Ponder branch and its process wiring.
 */
export async function readLegacyGatherCandidates(
  client: {
    readContract(request: {
      address: Address;
      abi: readonly unknown[];
      functionName: "gatherLiquidity";
      args: readonly [Address, number, bigint, bigint, Address];
      blockNumber: bigint;
    }): Promise<unknown>;
  },
  input: {
    lending: Address;
    market: Address;
    aprBps: number;
    target: bigint;
    borrower: Address;
    blockNumber: bigint;
  },
) {
  const [candidateIds, sufficient] = (await client.readContract({
    address: input.lending,
    abi: ovrfloLendingAbi,
    functionName: "gatherLiquidity",
    args: [
      input.market,
      input.aprBps,
      input.target,
      1n,
      input.borrower,
    ],
    blockNumber: input.blockNumber,
  })) as [bigint[], boolean];
  return { candidateIds, sufficient };
}

export const parityPonder = {
  fetchBorrowDemand,
  fetchHeldStreamIds,
};
