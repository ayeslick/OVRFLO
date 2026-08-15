"use client";

import { useMemo, useRef } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { readQuery } from "@/lib/query-keys";
import type { StreamSchedule } from "@/lib/payoff";

export type LoanStreamTruth = {
  streamId: bigint;
  withdrawable: bigint;
  schedule: StreamSchedule;
};

export function useLoanStreams(streamIds: readonly bigint[]): ReadonlyMap<string, LoanStreamTruth> {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const ids: bigint[] = [];
    for (const id of streamIds) {
      const key = id.toString();
      if (id > 0n && !seen.has(key)) {
        seen.add(key);
        ids.push(id);
      }
    }
    return ids;
  }, [streamIds]);

  const contracts = useMemo(
    () =>
      unique.flatMap((streamId) => [
        {
          address: SABLIER_LOCKUP_ADDRESS,
          abi: sablierLockupAbi,
          functionName: "getStream" as const,
          args: [streamId] as const,
        },
        {
          address: SABLIER_LOCKUP_ADDRESS,
          abi: sablierLockupAbi,
          functionName: "withdrawableAmountOf" as const,
          args: [streamId] as const,
        },
      ]),
    [unique],
  );

  const reads = useReadContracts({
    allowFailure: true,
    contracts,
    query: { ...readQuery, enabled: unique.length > 0 },
  });

  const lastKnown = useRef(new Map<string, LoanStreamTruth>());

  return useMemo(() => {
    const next = new Map(lastKnown.current);
    const rows = reads.data;
    if (!rows) return next;
    for (const [index, streamId] of unique.entries()) {
      const streamResult = rows[index * 2];
      const withdrawableResult = rows[index * 2 + 1];
      if (streamResult?.status !== "success" || withdrawableResult?.status !== "success") {
        // Burn / nonexistent: drop lastKnown so settled copy can say GONE.
        next.delete(streamId.toString());
        continue;
      }
      const stream = streamResult.result as {
        startTime: number;
        endTime: number;
        amounts: { deposited: bigint; withdrawn: bigint; refunded: bigint };
      };
      next.set(streamId.toString(), {
        streamId,
        withdrawable: withdrawableResult.result as bigint,
        schedule: {
          start: BigInt(stream.startTime),
          end: BigInt(stream.endTime),
          deposited: stream.amounts.deposited,
          withdrawn: stream.amounts.withdrawn,
          refunded: stream.amounts.refunded,
        },
      });
    }
    lastKnown.current = next;
    return next;
  }, [reads.data, unique]);
}

export function pledgedOwnerIsLending(owner: Address | undefined, lending: Address | null | undefined) {
  return Boolean(owner && lending && owner.toLowerCase() === lending.toLowerCase());
}
