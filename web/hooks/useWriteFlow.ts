"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

export function useWriteFlow(invalidateKeys: readonly (readonly unknown[])[] = []) {
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  });

  useEffect(() => {
    if (!receipt.isSuccess) return;
    for (const queryKey of invalidateKeys) {
      queryClient.invalidateQueries({ queryKey });
    }
  }, [invalidateKeys, queryClient, receipt.isSuccess]);

  return {
    writeContract: write.writeContract,
    hash: write.data,
    isSigning: write.isPending,
    isConfirming: receipt.isLoading,
    isConfirmed: receipt.isSuccess,
    error: write.error ?? receipt.error,
  };
}
