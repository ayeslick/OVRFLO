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
import type { SablierStream } from "@/lib/sablier";

interface Props {
  stream: SablierStream;
  ptName?: string;
  index: number;
}

type TxPhase = "idle" | "submitting" | "waiting" | "success" | "error";

export function StreamCard({ stream, ptName, index }: Props) {
  const { address, chainId } = useAccount();
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [error, setError] = useState<string>();

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
  const isFullyVested = pct >= 100;
  const isDepleted = stream.depleted;

  const withdrawableStr = withdrawable ? formatUnits(withdrawable, decimals) : "...";
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
  const statusLabel = isDepleted ? "Depleted" : isFullyVested ? "Fully Vested" : "Active";
  const withdrawButtonTitle = !address
    ? "Connect wallet to withdraw"
    : chainId !== CHAIN_ID
      ? `Switch to ${CHAIN_NAME} to withdraw`
      : feeInsufficient
        ? `Need ${minFee ? formatEther(minFee) : "?"} ETH for the withdraw fee`
        : undefined;

  return (
    <article
      className="nb-stream-card p-5 sm:p-6"
      data-testid={`card-stream-${stream.tokenId}`}
    >
      {/* Top row: Badge + Title + Status */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Index badge */}
          <span className="nb-badge nb-badge-cyan mono">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="text-base font-bold uppercase tracking-wide text-black">
              OVRFLO #{stream.tokenId}
            </h3>
            <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
          </div>
        </div>
        <span className={`nb-badge ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}>
          {statusLabel}
        </span>
      </div>

      {/* Streamed % + Progress */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="nb-kicker text-black/40">Streamed</span>
          <span className="mono text-sm font-bold text-[#5dc0f5]">{pct}% STREAMED</span>
        </div>
        <div
          role="progressbar"
          aria-label={`OVRFLO ${stream.tokenId} streamed progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(pct, 100))}
          className="nb-progress-track"
          data-testid={`progress-stream-${stream.tokenId}`}
        >
          <div
            className="nb-progress-fill"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* Info boxes */}
      <div className="mb-4 grid grid-cols-2 gap-0">
        <div className="nb-info-box nb-info-box-principal flex-col items-start gap-1">
          <span className="nb-preview-label">Withdrawable</span>
          <span className="mono text-base font-bold text-black">
            {withdrawableStr}
          </span>
        </div>
        <div className="nb-info-box nb-info-box-streaming flex-col items-start gap-1">
          <span className="nb-preview-label">Ends</span>
          <span className="text-base font-bold text-black">
            {new Date(end * 1000).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* Withdraw button */}
      <button
        type="button"
        onClick={handleWithdraw}
        disabled={!canWithdraw}
        title={withdrawButtonTitle}
        className="nb-button nb-button-dark w-full"
        data-testid={`button-withdraw-${stream.tokenId}`}
      >
        {txPhase === "submitting"
          ? "Submitting..."
          : txPhase === "waiting"
            ? "Confirming..."
            : txPhase === "success"
              ? "Done"
              : isDepleted
                ? "Closed"
                : "Withdraw"}
      </button>

      {/* Fee warning */}
      {feeInsufficient ? (
        <div className="nb-status nb-status-warning mt-3 text-xs leading-5">
          Insufficient ETH for the withdraw fee. Need {minFee ? formatEther(minFee) : "?"} ETH.
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="nb-status nb-status-error mt-3 break-all text-xs leading-5">
          {error}
          <button
            onClick={() => {
              setTxPhase("idle");
              setTxHash(undefined);
              setError(undefined);
            }}
            className="nb-link ml-2 inline-block text-[#b13a57]"
            data-testid={`button-retry-${stream.tokenId}`}
          >
            Retry
          </button>
        </div>
      ) : null}
    </article>
  );
}
