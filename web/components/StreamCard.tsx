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
    <article className="nb-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="nb-kicker text-[var(--color-border)]">OVRFLO #{stream.tokenId}</p>
          <h3 className="mt-2 text-xl text-[var(--color-ink)]">{label}</h3>
        </div>
        <span className="nb-chip nb-kicker">{pct}% vested</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[88px_minmax(0,1fr)] lg:items-start">
        <div className="flex h-[88px] w-[88px] items-center justify-center border-2 border-[var(--color-ink)] bg-[var(--color-accent)] text-center text-xs font-bold uppercase tracking-[0.05em] text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]">
          Live
          <br />
          Flow
        </div>

        <div>
          <p className="nb-kicker text-[var(--color-border)]">Withdrawable now</p>
          <p className="mono mt-2 text-3xl font-bold uppercase tracking-[0.05em] text-[var(--color-ink)] sm:text-[2rem]">
            {withdrawableStr} {stream.asset.symbol}
            {withdrawableUsd ? ` · ${withdrawableUsd}` : ""}
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink)]/75">Ends {new Date(end * 1000).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[8px] border-2 border-[var(--color-border)] bg-[repeating-linear-gradient(90deg,var(--color-surface-muted)_0_18px,var(--color-surface)_18px_36px)]">
        <div
          className="h-4 border-r-2 border-[var(--color-ink)] bg-[var(--color-accent)]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="mt-5 grid gap-3 text-sm text-[var(--color-ink)] sm:grid-cols-3">
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Asset</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">{stream.asset.symbol}</div>
        </div>
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Withdraw fee</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">
            {minFee !== undefined && minFee > 0n
              ? `${formatEther(minFee)} ETH${withdrawFeeUsd ? ` · ${withdrawFeeUsd}` : ""}`
              : "0 ETH"}
          </div>
        </div>
        <div className="rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-hard-sm)]">
          <div className="nb-kicker text-[var(--color-border)]">Status</div>
          <div className="mt-2 font-semibold uppercase tracking-[0.05em]">
            {txPhase === "success" ? "Claimed" : txPhase === "waiting" ? "Confirming" : "Ready"}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--color-ink)]/75">
          Claimable flows stay modular and use the same hard-edged system as preview mode.
        </p>
        <button
          onClick={handleWithdraw}
          disabled={!canWithdraw}
          className="nb-button w-full sm:w-auto"
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

      {feeInsufficient ? (
        <div className="nb-status nb-status-warning mt-4 text-sm leading-6">
          Insufficient ETH for the withdraw fee. Need {minFee ? formatEther(minFee) : "?"} ETH.
        </div>
      ) : null}

      {address && chainId !== CHAIN_ID ? (
        <div className="mt-4">
          <WalletActionCta />
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
