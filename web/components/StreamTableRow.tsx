"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import { formatUnits, formatEther, type Address } from "viem";
import { SABLIER_LOCKUP, CHAIN_ID, CHAIN_NAME } from "@/lib/config";
import { sablierLockupAbi } from "@/lib/contracts";
import { parseUserError } from "@/lib/tx-errors";
import { preflight } from "@/lib/preflight";
import type { SablierStream } from "@/lib/sablier";

interface Props {
  stream: SablierStream;
  ptName?: string;
  index: number;
}

type TxPhase = "idle" | "submitting" | "waiting" | "success" | "error";

export function StreamTableRow({ stream, ptName, index }: Props) {
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
  const publicClient = usePublicClient();

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

  const withdrawableStr = withdrawable
    ? formatUnits(withdrawable, decimals)
    : "...";
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
    if (!publicClient) return;
    setTxPhase("submitting");
    setError(undefined);
    // R15 preflight — simulate the Sablier withdrawMax call with the exact
    // msg.value (minFee) we'll send. If the user's ETH balance dropped
    // below minFee between render and click, or the stream became depleted,
    // classifyUserError surfaces a targeted message and the wallet never
    // prompts.
    const sim = await preflight(
      publicClient,
      {
        address: SABLIER_LOCKUP as Address,
        abi: sablierLockupAbi,
        functionName: "withdrawMax",
        args: [tokenId, address],
        value: minFee,
        account: address,
      },
      "Withdraw failed"
    );
    if (!sim.ok) {
      if (sim.error.kind === "user-rejected") {
        setTxPhase("idle");
      } else {
        setTxPhase("error");
        setError(sim.error.message);
      }
      return;
    }
    try {
      const hash = await writeContractAsync(
        sim.request as unknown as Parameters<typeof writeContractAsync>[0]
      );
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
  }, [address, withdrawable, minFee, publicClient, tokenId, writeContractAsync]);

  const label = ptName ?? stream.asset.symbol;
  const statusLabel = isDepleted
    ? "Depleted"
    : isFullyVested
      ? "Fully Vested"
      : "Active";
  const withdrawButtonTitle = !address
    ? "Connect wallet to withdraw"
    : chainId !== CHAIN_ID
      ? `Switch to ${CHAIN_NAME} to withdraw`
      : feeInsufficient
        ? `Need ${minFee ? formatEther(minFee) : "?"} ETH for the withdraw fee`
        : undefined;

  const buttonLabel =
    txPhase === "submitting"
      ? "Submitting..."
      : txPhase === "waiting"
        ? "Confirming..."
        : txPhase === "success"
          ? "Done"
          : isDepleted
            ? "Closed"
            : "Withdraw";

  const endDate = new Date(end * 1000).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });

  return (
    <>
      {/* Desktop row */}
      <tr
        className="nb-table-row group hidden sm:table-row"
        data-testid={`row-stream-${stream.tokenId}`}
      >
        {/* # */}
        <td className="nb-table-cell w-12 text-center">
          <span className="nb-badge nb-badge-cyan mono text-[10px]">
            {String(index + 1).padStart(2, "0")}
          </span>
        </td>
        {/* Stream */}
        <td className="nb-table-cell">
          <div className="flex items-center gap-2">
            <div>
              <span className="text-sm font-bold uppercase tracking-wide text-black">
                OVRFLO #{stream.tokenId}
              </span>
              <span
                className={`nb-badge ml-2 text-[9px] ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}
              >
                {statusLabel}
              </span>
              <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
            </div>
          </div>
        </td>
        {/* Streamed */}
        <td className="nb-table-cell w-40">
          <div className="flex items-center gap-2">
            <div className="nb-progress-track-sm flex-1">
              <div
                className="nb-progress-fill"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="mono text-xs font-bold text-[#5dc0f5] whitespace-nowrap">
              {Math.round(pct)}%
            </span>
          </div>
        </td>
        {/* Withdrawable */}
        <td className="nb-table-cell">
          <span className="mono text-sm font-bold text-black">
            {withdrawableStr}
          </span>
          <p className="nb-kicker mt-0.5 text-black/30">{stream.asset.symbol}</p>
        </td>
        {/* Ends */}
        <td className="nb-table-cell">
          <span className="text-sm text-black">{endDate}</span>
        </td>
        {/* Action */}
        <td className="nb-table-cell w-32 text-right">
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={!canWithdraw}
            title={withdrawButtonTitle}
            className="nb-button nb-button-dark px-3 py-1.5 text-[11px] min-h-0 h-9"
            data-testid={`button-withdraw-${stream.tokenId}`}
          >
            {buttonLabel}
          </button>
        </td>
      </tr>

      {/* Mobile card fallback */}
      <tr
        className="sm:hidden"
        data-testid={`row-stream-mobile-${stream.tokenId}`}
      >
        <td colSpan={6} className="p-0">
          <div className="nb-stream-card mx-0 mb-3 p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="nb-badge nb-badge-cyan mono text-[10px]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className="text-sm font-bold uppercase tracking-wide text-black">
                    OVRFLO #{stream.tokenId}
                  </span>
                  <p className="nb-kicker mt-0.5 text-black/40">{label}</p>
                </div>
              </div>
              <span
                className={`nb-badge text-[9px] ${isDepleted ? "nb-badge-dark opacity-50" : "nb-badge-active"}`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="mb-3 flex items-center gap-2">
              <div className="nb-progress-track-sm flex-1">
                <div
                  className="nb-progress-fill"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span className="mono text-xs font-bold text-[#5dc0f5]">
                {Math.round(pct)}%
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="nb-kicker text-black/40">Withdrawable</span>
                <p className="mono mt-0.5 font-bold text-black">
                  {withdrawableStr}
                </p>
                <p className="nb-kicker mt-0.5 text-black/30">
                  {stream.asset.symbol}
                </p>
              </div>
              <div>
                <span className="nb-kicker text-black/40">Ends</span>
                <p className="mt-0.5 font-bold text-black">{endDate}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={!canWithdraw}
              title={withdrawButtonTitle}
              className="nb-button nb-button-dark w-full"
              data-testid={`button-withdraw-mobile-${stream.tokenId}`}
            >
              {buttonLabel}
            </button>
          </div>
        </td>
      </tr>

      {/* Error / warning row */}
      {(feeInsufficient || error) ? (
        <tr className="hidden sm:table-row">
          <td />
          <td colSpan={5} className="px-4 pb-3 pt-0">
            {feeInsufficient ? (
              <div className="nb-status nb-status-warning text-xs leading-5">
                Insufficient ETH for the withdraw fee. Need{" "}
                {minFee ? formatEther(minFee) : "?"} ETH.
              </div>
            ) : null}
            {error ? (
              <div className="nb-status nb-status-error break-all text-xs leading-5">
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
