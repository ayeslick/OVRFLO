"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { invalidateAllOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";

export function useWriteFlow(user?: Address) {
  const queryClient = useQueryClient();
  const lastInvalidatedHash = useRef<`0x${string}` | undefined>(undefined);
  const cancelRetry = useRef<(() => void) | undefined>(undefined);
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  });

  useEffect(() => {
    if (!receipt.isSuccess || !write.data || lastInvalidatedHash.current === write.data) return;
    lastInvalidatedHash.current = write.data;
    invalidateAllOnChainReads(queryClient, user);
    cancelRetry.current?.();
    cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
  }, [queryClient, receipt.isSuccess, user, write.data]);

  useEffect(() => () => cancelRetry.current?.(), []);

  return {
    writeContract: write.writeContract,
    reset: write.reset,
    hash: write.data,
    receipt: receipt.data,
    isSigning: write.isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    error: write.error ?? receipt.error,
  };
}
