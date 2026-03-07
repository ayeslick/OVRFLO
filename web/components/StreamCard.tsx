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
import { SABLIER_LOCKUP, CHAIN_ID } from "@/lib/constants";
import { sablierLockupAbi } from "@/lib/contracts";
import { parseUserError } from "@/lib/tx-errors";
import { useUsdPrices, getTokenUsd, formatUsdValue } from "@/hooks/useUsdPrices";
import { WalletActionCta } from "./WalletActionCta";
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
  const elapsed = Math.min(now - start, total);
  const pct = total > 0 ? Math.round((elapsed / total) * 1000) / 10 : 0;
  const decimals = stream.asset.decimals;

  const withdrawableStr = withdrawable
    ? formatUnits(withdrawable, decimals)
    : "...";
  const tokenUsd = getTokenUsd(usdPrices?.tokenUsd, stream.asset.address as `0x${string}`);
  const withdrawableUsd = withdrawable ? formatUsdValue(withdrawable, decimals, tokenUsd) : undefined;
  const withdrawFeeUsd = minFee && usdPrices?.nativeUsd ? formatUsdValue(minFee, 18, usdPrices.nativeUsd) : undefined;

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

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 hover:border-[var(--color-border-hover)] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[var(--color-heading)] font-semibold">
          OVRFLO #{stream.tokenId}
        </span>
        <span className="text-sm text-[var(--color-muted)]">{label}</span>
      </div>

      <div className="w-full h-2 bg-[var(--color-border)] rounded-full mb-2">
        <div
          className="h-2 bg-[var(--color-accent)] rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="text-xs text-[var(--color-muted)] mb-3">
        {pct}% vested
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm">
            Withdrawable:{" "}
            <span className="mono text-[var(--color-heading)]">
              {withdrawableStr}
            </span>{" "}
            {stream.asset.symbol}
            {withdrawableUsd ? ` (${withdrawableUsd})` : ""}
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            Ends: {new Date(end * 1000).toLocaleDateString()}
          </div>
          {minFee !== undefined && minFee > 0n && (
            <div className="text-xs text-[var(--color-muted)] mt-1">
              Withdraw fee: {formatEther(minFee)} ETH{withdrawFeeUsd ? ` (${withdrawFeeUsd})` : ""}
            </div>
          )}
          {feeInsufficient && (
            <div className="text-xs text-red-400 mt-1">
              Insufficient ETH for withdraw fee (need{" "}
              {minFee ? formatEther(minFee) : "?"} ETH)
            </div>
          )}
        </div>
        <button
          onClick={handleWithdraw}
          disabled={!canWithdraw}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
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
      {address && chainId !== CHAIN_ID && (
        <div className="mt-3">
          <WalletActionCta />
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 mt-2 break-all">
          {error}
          <button
            onClick={() => {
              setTxPhase("idle");
              setTxHash(undefined);
              setError(undefined);
            }}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
