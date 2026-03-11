"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import { formatUnits, formatEther, type Address } from "viem";
import { SABLIER_LOCKUP, CHAIN_ID, CHAIN_NAME } from "@/lib/constants";
import { sablierLockupAbi } from "@/lib/contracts";
import { parseUserError } from "@/lib/tx-errors";
import { useUsdPrices, getTokenUsd, formatUsdValue } from "@/hooks/useUsdPrices";
import type { SablierStream } from "@/lib/sablier";

interface Props {
  stream: SablierStream;
  ptName?: string;
}

type TxPhase = "idle" | "submitting" | "waiting" | "success" | "error";

export function StreamCard({ stream, ptName }: Props) {
  const { address, chainId } = useAccount();
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [error, setError] = useState<string>();
  const { data: usdPrices } = useUsdPrices([stream.asset.address as `0x${string}`]);

  const tokenId = BigInt(stream.tokenId);

  const { data: withdrawable } = useReadContract({
    address: SABLIER_LOCKUP as Address,
    abi: sablierLockupAbi,
    functionName: "withdrawableAmountOf",
    args: [tokenId],
  });

  const { data: minFee } = useReadContract({
    address: SABLIER_LOCKUP as Address,
    abi: sablierLockupAbi,
    functionName: "calculateMinFeeWei",
    args: [tokenId],
  });

  const { data: ethBalance } = useBalance({ address });

  const { writeContractAsync } = useWriteContract();

  const { isSuccess: receiptConfirmed, isError: receiptFailed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      query: { enabled: !!txHash },
    });

  useEffect(() => {
    if (!txHash) return;
    if (receiptConfirmed && txPhase === "waiting") {
      setTxPhase("success");
      setTxHash(undefined);
    }
    if (receiptFailed) {
      setTxPhase("error");
      setError("Transaction failed on-chain.");
      setTxHash(undefined);
    }
  }, [receiptConfirmed, receiptFailed, txPhase, txHash]);

  const now = Date.now() / 1000;
  const start = Number(stream.startTime);
  const end = Number(stream.endTime);
  const total = end - start;
  const elapsed = Math.max(0, Math.min(now - start, total));
  const pct = total > 0 ? Math.round((elapsed / total) * 1000) / 10 : 0;
  const decimals = stream.asset.decimals;

  const withdrawableStr = withdrawable ? formatUnits(withdrawable, decimals) : "...";
  const tokenUsd = getTokenUsd(usdPrices?.tokenUsd, stream.asset.address as `0x${string}`);
  const withdrawableUsd = withdrawable ? formatUsdValue(withdrawable, decimals, tokenUsd) : undefined;
  const feeInsufficient =
    minFee !== undefined &&
    ethBalance?.value !== undefined &&
    ethBalance.value < minFee;

  const canWithdraw =
    address &&
    chainId === CHAIN_ID &&
    withdrawable &&
    withdrawable > 0n &&
    !feeInsufficient &&
    txPhase === "idle";

  const handleWithdraw = useCallback(async () => {
    if (!address || !withdrawable || minFee === undefined) return;
    setTxPhase("submitting");
    setError(undefined);
    try {
      const hash = await writeContractAsync({
        address: SABLIER_LOCKUP as Address,
        abi: sablierLockupAbi,
        functionName: "withdrawMax",
        args: [tokenId, address],
        value: minFee,
      });
      setTxHash(hash);
      setTxPhase("waiting");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Withdraw failed";
      if (!msg.includes("User rejected")) {
        setTxPhase("error");
        setError(parseUserError(e, "Withdraw failed"));
      } else {
        setTxPhase("idle");
      }
    }
  }, [address, withdrawable, minFee, tokenId, writeContractAsync]);

  const label = ptName ?? stream.asset.symbol;
  const withdrawButtonTitle = !address
    ? "Connect wallet to withdraw"
    : chainId !== CHAIN_ID
      ? `Switch to ${CHAIN_NAME} to withdraw`
      : feeInsufficient
        ? `Need ${minFee ? formatEther(minFee) : "?"} ETH for the withdraw fee`
        : undefined;

  return (
    <article className="nb-panel rounded-[4px] p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="border-b-2 border-[var(--color-border)] pb-3">
          <h3 className="text-base text-[var(--color-ink)] sm:text-lg">{`OVRFLO #${stream.tokenId} · ${label}`}</h3>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="nb-kicker text-[var(--color-border)]">Streamed</span>
            <span className="mono text-sm font-semibold tracking-[0.05em] text-[var(--color-ink)]">{pct}% streamed</span>
          </div>
          <div
            role="progressbar"
            aria-label={`OVRFLO ${stream.tokenId} streamed progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(pct, 100))}
            className="overflow-hidden rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-[var(--shadow-hard-sm)]"
          >
            <div className="h-3 bg-[var(--color-accent)]" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t-2 border-[var(--color-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-ink)]">
            <span className="nb-kicker mr-2 text-[var(--color-border)]">Withdrawable:</span>
            <span className="mono font-semibold uppercase tracking-[0.05em]">{withdrawableStr} {stream.asset.symbol}</span>
            {withdrawableUsd ? <span className="ml-2 text-xs text-[var(--color-muted)]">{withdrawableUsd}</span> : null}
          </p>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={!canWithdraw}
            title={withdrawButtonTitle}
            className="nb-button w-full rounded-[4px] sm:w-auto"
          >
            {txPhase === "submitting"
              ? "Submitting..."
              : txPhase === "waiting"
                ? "Confirming..."
                : txPhase === "success"
                  ? "Done"
                  : "Withdraw"}
          </button>
        </div>

        <p className="border-t-2 border-[var(--color-border)] pt-3 text-sm text-[var(--color-ink)]">
          <span className="nb-kicker mr-2 text-[var(--color-border)]">Ends:</span>
          <span className="font-semibold uppercase tracking-[0.05em]">{new Date(end * 1000).toLocaleDateString()}</span>
        </p>
      </div>

      {feeInsufficient ? (
        <div className="nb-status nb-status-warning mt-4 text-sm leading-6">
          Insufficient ETH for the withdraw fee. Need {minFee ? formatEther(minFee) : "?"} ETH.
        </div>
      ) : null}

      {error ? (
        <div className="nb-status nb-status-error mt-4 break-all text-sm leading-6">
          {error}
          <button
            onClick={() => {
              setTxPhase("idle");
              setTxHash(undefined);
              setError(undefined);
            }}
            className="nb-link ml-2 inline-block text-[#8e2340]"
          >
            Retry
          </button>
        </div>
      ) : null}
    </article>
  );
}
