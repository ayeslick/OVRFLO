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

  // `receipt.isSuccess` only means the RPC fetch resolved a receipt — it says
  // nothing about the transaction's own outcome. A reverted on-chain tx still
  // mines a receipt, so the on-chain result must be read from
  // `receipt.data.status` ('success' | 'reverted') rather than trusted from
  // isSuccess alone (see docs/solutions/logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md).
  const isConfirmed = receipt.isSuccess && receipt.data?.status === "success";
  const isReverted = receipt.isSuccess && receipt.data?.status === "reverted";

  useEffect(() => {
    if (!isConfirmed || !write.data || lastInvalidatedHash.current === write.data) return;
    lastInvalidatedHash.current = write.data;
    invalidateAllOnChainReads(queryClient, user);
    cancelRetry.current?.();
    cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
  }, [queryClient, isConfirmed, user, write.data]);

  useEffect(() => () => cancelRetry.current?.(), []);

  return {
    writeContract: write.writeContract,
    reset: write.reset,
    hash: write.data,
    receipt: receipt.data,
    isSigning: write.isPending,
    isConfirming: receipt.isLoading,
    isConfirmed,
    isReverted,
    error: write.error ?? receipt.error,
  };
}
