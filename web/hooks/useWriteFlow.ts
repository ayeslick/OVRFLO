"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { chainId as configuredChainId } from "@/lib/config";
import { invalidateOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";

export function useWriteFlow(user?: Address) {
  const queryClient = useQueryClient();
  const lastInvalidatedHash = useRef<`0x${string}` | undefined>(undefined);
  // R39: the address each write targeted, so invalidation can be scoped to the
  // reads that write could actually have changed. Captured at submit rather
  // than derived at confirm time — by then the args are gone.
  const touched = useRef<Address[]>([]);
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
    invalidateOnChainReads(queryClient, {
      contracts: touched.current,
      user,
      // A write to Sablier moves a stream NFT, and so does one to a lending
      // market (sale fills and loan escrow both transfer it). Either can change
      // which streams the user holds.
      streams: touched.current.length > 0,
    });
    cancelRetry.current?.();
    cancelRetry.current = scheduleHeldStreamsRetry(queryClient, user);
  }, [queryClient, isConfirmed, user, write.data]);

  useEffect(() => () => cancelRetry.current?.(), []);

  // R6/KTD5: every write names its expected chain here rather than at the ~19
  // call sites, so a wrong-chain broadcast is refused at the write layer even
  // when the FormBody gate is bypassed — and so a call site added later cannot
  // forget it. wagmi refuses the write when the connected chain does not match.
  // The cast is a TypeScript limitation, not a soundness hole. `writeContract`
  // is generic over the ABI and its parameter is a union of per-variant shapes;
  // TS will not distribute a spread across that union, and typing the wrapper
  // erases the generics that give call sites their argument checking. Casting
  // the wrapper back to the original signature keeps call-site inference exactly
  // as it was — only the injection is untyped, and `chainId` is valid on every
  // member of the union.
  const writeContract = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((args: any, options: any) => {
      // R39: record the target so the post-confirm invalidation can be scoped
      // to the reads this write could have changed. Captured here rather than
      // derived at confirm time, when the args are gone.
      if (args?.address) touched.current = [args.address as Address];
      return write.writeContract({ chainId: configuredChainId, ...args }, options);
    }) as typeof write.writeContract,
    [write],
  );

  return {
    writeContract,
    reset: write.reset,
    hash: write.data,
    receipt: receipt.data,
    isSigning: write.isPending,
    isConfirming: receipt.isLoading,
    isConfirmed,
    isReverted,
    error: write.error ?? receipt.error,
    // R8/M-2: the single "did this fail" signal. `error` alone is null on an
    // on-chain revert — the receipt fetch succeeded, the transaction did not —
    // so five consumers independently reset their optimistic approval state on
    // `error` and silently kept it through a reverted approve. Anything asking
    // whether a write failed must ask this, not `error`.
    hasFailed: Boolean(write.error ?? receipt.error) || isReverted,
  };
}
