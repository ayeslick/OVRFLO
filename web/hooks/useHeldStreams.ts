"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { fetchHeldStreamIds } from "@/lib/ponder";
import { streamKeys } from "@/lib/query-keys";
import type { HeldStream } from "@/lib/types";

export function useHeldStreams(user: Address | null | undefined) {
  const discovery = useQuery({
    queryKey: streamKeys.held(user),
    enabled: Boolean(user),
    queryFn: () => fetchHeldStreamIds(user as Address),
  });

  const streamIds = useMemo(() => discovery.data?.map((stream) => stream.streamId) ?? [], [discovery.data]);
  const sablierReads = useReadContracts({
    contracts: streamIds.map((streamId) => ({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "withdrawableAmountOf" as const,
      args: [streamId] as const,
    })),
    query: { enabled: streamIds.length > 0 },
  });

  const streams = useMemo<HeldStream[]>(() => {
    return (discovery.data ?? []).map((stream, index) => {
      const withdrawable = sablierReads.data?.[index];
      return {
        ...stream,
        withdrawable: withdrawable?.status === "success" ? withdrawable.result : stream.withdrawable,
      };
    });
  }, [discovery.data, sablierReads.data]);

  return {
    queryKey: streamKeys.held(user),
    streams,
    isLoading: discovery.isLoading || sablierReads.isLoading,
    error: discovery.error ?? sablierReads.error,
  };
}
