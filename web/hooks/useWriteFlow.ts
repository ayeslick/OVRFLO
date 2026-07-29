"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { chainId as configuredChainId } from "@/lib/config";
import { invalidateOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";

/**
 * @param related Contracts whose reads a write from this flow can change even
 * though the transaction is not addressed to them — the tokens it pulls or
 * mints, the Sablier stream it moves. Pass `marketContracts(market)`; without
 * it, invalidation is scoped to the transaction's `to` and token balances and
 * allowances stay stale after the receipt.
 */
export function useWriteFlow(user?: Address, related: readonly Address[] = EMPTY) {
  const queryClient = useQueryClient();
  const lastInvalidatedHash = useRef<`0x${string}` | undefined>(undefined);
  // R39: the addresses each write could have changed, so invalidation can be
  // scoped to those reads. Captured at submit rather than derived at confirm
  // time — by then the args are gone.
  const touched = useRef<Address[]>([]);
  // Read at submit time rather than closed over, so a call site that recomputes
  // its market set between renders cannot pin an old one into `writeContract`.
  const relatedRef = useRef(related);
  relatedRef.current = related;
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
      // R39: record the target *and* the market's other contracts, so the
      // post-confirm invalidation covers the reads this write could have
      // changed — including the token balances and allowances a call to the
      // vault or the lending market moves. Captured here rather than derived at
      // confirm time, when the args are gone.
      touched.current = args?.address
        ? [args.address as Address, ...relatedRef.current]
        : [...relatedRef.current];
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

// Module-level so the default argument keeps a stable identity across renders.
const EMPTY: readonly Address[] = [];
