"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis";
import { chainId as configuredChainId } from "@/lib/config";
import { isRevertFailure } from "@/lib/errors";

type WriteFlow = {
  writeContract: (args: never) => void;
  isConfirmed: boolean;
  hasFailed: boolean;
  isReverted: boolean;
  error: unknown;
};

type Attempt = { token: Address; spender: Address; amount: bigint; allowance: bigint };

/**
 * Approves optimistically, and only falls back to a zero-first sequence if the
 * direct approval actually fails the way a USDT-class token fails.
 *
 * R28/L-3: some ERC-20s revert when a non-zero allowance is changed to another
 * non-zero value, so the textbook fix is to always clear to zero first. Doing
 * that unconditionally would cost an extra transaction and an extra signature
 * on every re-approve — real gas, paid on every deposit and repay — to defend
 * against a revert that wstETH cannot produce. Since the failure is observable
 * and recoverable, the cost only needs paying when it is real.
 *
 * The common path is one transaction. The fallback triggers only when all of:
 * the approve failed *by reverting*, the existing allowance was non-zero, and
 * the target was also non-zero — the exact shape of the revert this defends
 * against. It retries once, so a token failing for some other reason surfaces
 * its error instead of looping.
 */
export function useZeroFirstApprove(approveTx: WriteFlow) {
  // The attempt that is currently in flight, so a failure can be classified.
  const attempt = useRef<Attempt | null>(null);
  // What to re-submit once the clearing approve confirms.
  const pending = useRef<Attempt | null>(null);
  const [clearing, setClearing] = useState(false);
  // Whether the write flow has reset since the clearing approve was issued.
  const settled = useRef(false);
  const [usedFallback, setUsedFallback] = useState(false);

  const write = useCallback(
    (token: Address, spender: Address, amount: bigint) => {
      approveTx.writeContract({
        chainId: configuredChainId,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      } as never);
    },
    [approveTx],
  );

  const submit = useCallback(
    (token: Address, spender: Address, amount: bigint, currentAllowance: bigint) => {
      attempt.current = { token, spender, amount, allowance: currentAllowance };
      pending.current = null;
      setUsedFallback(false);
      write(token, spender, amount);
    },
    [write],
  );

  useEffect(() => {
    if (clearing) {
      // The failure that triggered the fallback is still readable for a tick
      // after the clearing approve is issued — wagmi does not clear the prior
      // error synchronously. Reading it here would make the hook abort its own
      // retry, so wait for the flow to settle before believing either outcome.
      if (!settled.current) {
        if (!approveTx.hasFailed && !approveTx.isConfirmed) settled.current = true;
        return;
      }

      if (approveTx.isConfirmed && pending.current) {
        const next = pending.current;
        pending.current = null;
        setClearing(false);
        settled.current = false;
        attempt.current = { ...next, allowance: 0n };
        write(next.token, next.spender, next.amount);
        return;
      }

      if (approveTx.hasFailed) {
        // The clearing approve itself failed — stop rather than loop, and let
        // the form surface the error normally.
        pending.current = null;
        setClearing(false);
        settled.current = false;
      }
      return;
    }

    // A confirmed approve retires its attempt. Without this the attempt lingers
    // for the life of the form, and any *later* approve failure — a rejected
    // signature on the next action, an unrelated revert — would re-fire a
    // zero-approve for an allowance that was already set correctly, spending a
    // transaction and moving chain state for no reason. The E2E suite caught
    // exactly that as an unexpected stream surviving into a later scenario.
    if (approveTx.isConfirmed) {
      attempt.current = null;
      return;
    }

    if (!approveTx.hasFailed) return;

    const failed = attempt.current;
    if (!failed) return;

    // Only a revert with the non-zero-to-non-zero shape is worth retrying.
    // `hasFailed` alone is too broad: it also covers a rejected signature and an
    // RPC that never answered, and neither says anything about the token. Firing
    // the fallback on those asks the wallet to approve zero right after the user
    // declined, and buries the real error behind a second prompt.
    const looksLikeNonZeroReset =
      failed.allowance > 0n && failed.amount > 0n && isRevertFailure(approveTx.error, approveTx.isReverted);
    if (!looksLikeNonZeroReset) {
      attempt.current = null;
      return;
    }

    attempt.current = null;
    pending.current = failed;
    settled.current = false;
    setClearing(true);
    setUsedFallback(true);
    write(failed.token, failed.spender, 0n);
  }, [approveTx, clearing, write]);

  return {
    submit,
    /** True while the clearing approve is in flight, so a form can explain the second prompt. */
    clearing,
    /** True once the fallback has engaged for this attempt — this token needs zero-first. */
    usedFallback,
  };
}
