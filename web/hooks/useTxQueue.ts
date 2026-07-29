"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { encodeFunctionData } from "viem";
import type { Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { chainId as configuredChainId, SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import type { QueuedTx } from "@/lib/claim-all";
import { invalidateAllOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";
import { MAX_UINT128 } from "@/lib/lending-math";

export type QueueRowStatus = "pending" | "signing" | "confirming" | "confirmed" | "failed";
export type QueueRow = { tx: QueuedTx; status: "pending" | "confirmed" | "failed" };

// Sequential claim-all runner (KTD4): one tx at a time, advance only on receipt,
// coarse invalidation after EVERY confirmed receipt. A failure stops the queue
// after the in-flight tx; resume() takes a FRESH plan recomputed from live data
// (never a blind retry) and keeps confirmed rows checked off. A signer switch
// pauses auto-advance after the in-flight tx settles.
export function useTxQueue(user?: Address) {
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  });

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const handledHash = useRef<`0x${string}` | undefined>(undefined);
  const previousUser = useRef(user);
  const userRef = useRef(user);
  userRef.current = user;
  const cancelRetry = useRef<(() => void) | undefined>(undefined);

  const execute = useCallback(
    (tx: QueuedTx) => {
      if (tx.kind === "pool-claims") {
        write.writeContract({
          chainId: configuredChainId,
          address: tx.lending,
          abi: ovrfloLendingAbi,
          functionName: "multicall",
          args: [
            tx.loanIds.map((loanId) =>
              encodeFunctionData({
                abi: ovrfloLendingAbi,
                functionName: "claimLoanPoolShare",
                args: [loanId, MAX_UINT128],
              }),
            ),
          ],
        });
      } else {
        const to = userRef.current;
        if (!to) return;
        write.writeContract({
          chainId: configuredChainId,
          address: SABLIER_LOCKUP_ADDRESS,
          abi: sablierLockupAbi,
          functionName: "withdrawMax",
          args: [tx.streamId, to],
        });
      }
    },
    [write],
  );

  const start = useCallback(
    (plan: QueuedTx[]) => {
      if (plan.length === 0) return;
      handledHash.current = undefined;
      write.reset();
      setRows(plan.map((tx) => ({ tx, status: "pending" as const })));
      setIndex(0);
      setPaused(false);
      setRunning(true);
      execute(plan[0]);
    },
    [execute, write],
  );

  // Fresh plan for the remainder; already-confirmed rows stay checked off.
  const resume = useCallback(
    (freshPlan: QueuedTx[]) => {
      const confirmed = rows.filter((row) => row.status === "confirmed");
      const next = [...confirmed, ...freshPlan.map((tx) => ({ tx, status: "pending" as const }))];
      handledHash.current = undefined;
      write.reset();
      setRows(next);
      setIndex(confirmed.length);
      setPaused(false);
      if (freshPlan.length === 0) {
        setRunning(false);
        return;
      }
      setRunning(true);
      execute(freshPlan[0]);
    },
    [execute, rows, write],
  );

  // Signer switch: never keep firing txs at a different signer (KTD4).
  useEffect(() => {
    if (previousUser.current !== undefined && user !== previousUser.current && running) {
      setPaused(true);
    }
    previousUser.current = user;
  }, [running, user]);

  // Receipt confirmed: invalidate, mark, advance (unless paused or done).
  // `receipt.isSuccess` only means the RPC fetch resolved a receipt — it says
  // nothing about the transaction's own outcome. A reverted on-chain tx (e.g.
  // withdrawMax on a stream someone else already fully claimed) still mines
  // a receipt, so the on-chain result must be read from `receipt.data.status`
  // ('success' | 'reverted') rather than trusted from isSuccess alone.
  useEffect(() => {
    if (!running || !receipt.isSuccess || !write.data || handledHash.current === write.data) return;
    handledHash.current = write.data;
    if (receipt.data?.status !== "success") {
      const failedIndex = index;
      setRows((current) => current.map((row, i) => (i === failedIndex ? { ...row, status: "failed" } : row)));
      setRunning(false);
      return;
    }
    invalidateAllOnChainReads(queryClient, userRef.current);
    cancelRetry.current?.();
    cancelRetry.current = scheduleHeldStreamsRetry(queryClient, userRef.current);
    const confirmedIndex = index;
    const nextIndex = confirmedIndex + 1;
    setRows((current) => current.map((row, i) => (i === confirmedIndex ? { ...row, status: "confirmed" } : row)));
    setIndex(nextIndex);
    write.reset();
    if (paused || nextIndex >= rows.length) {
      setRunning(false);
      return;
    }
    execute(rows[nextIndex].tx);
  }, [execute, index, paused, queryClient, receipt.data, receipt.isSuccess, rows, running, write]);

  useEffect(() => () => cancelRetry.current?.(), []);

  // Failure (rejected signature or reverted tx): stop after the in-flight tx.
  const failure = write.error ?? receipt.error ?? null;
  useEffect(() => {
    if (!running || !failure) return;
    const failedIndex = index;
    setRows((current) => current.map((row, i) => (i === failedIndex ? { ...row, status: "failed" } : row)));
    setRunning(false);
  }, [failure, index, running]);

  const statusOf = (i: number): QueueRowStatus => {
    const stored = rows[i]?.status ?? "pending";
    if (stored !== "pending") return stored;
    if (i === index && running) {
      if (write.isPending) return "signing";
      if (receipt.isLoading) return "confirming";
    }
    return "pending";
  };

  const confirmedCount = rows.filter((row) => row.status === "confirmed").length;
  const failed = rows.some((row) => row.status === "failed");

  return {
    rows,
    statusOf,
    start,
    resume,
    running,
    paused,
    failed,
    error: failure,
    inFlight: running && (write.isPending || receipt.isLoading),
    done: rows.length > 0 && confirmedCount === rows.length,
  };
}
