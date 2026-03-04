"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/constants";
import { ovrfloAbi, erc20Abi } from "@/lib/contracts";
import { useTokenDecimals, getDecimals } from "@/hooks/useTokenMeta";
import { SlippageSettings } from "./SlippageSettings";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
}

type Step = "underlying" | "maturity" | "amount";
type TxPhase =
  | "idle"
  | "approving-pt"
  | "waiting-pt-approval"
  | "approving-underlying"
  | "waiting-underlying-approval"
  | "creating"
  | "waiting-deposit"
  | "success"
  | "error";

export function NewOvrfloModal({ open, onClose, ovrflos, allMarkets }: Props) {
  const { address, chainId } = useAccount();
  const [step, setStep] = useState<Step>("underlying");
  const [selectedOvrflo, setSelectedOvrflo] = useState<OvrfloEntry>();
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo>();
  const [amountStr, setAmountStr] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();

  const { isSuccess: receiptConfirmed, isError: receiptFailed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      query: { enabled: !!txHash },
    });

  // Token decimals for all relevant tokens
  const decMap = useTokenDecimals([
    selectedMarket?.ptToken,
    selectedMarket?.underlying,
    selectedMarket?.ovrfloToken,
  ]);

  const ptDecimals = getDecimals(decMap, selectedMarket?.ptToken);
  const underlyingDecimals = getDecimals(decMap, selectedMarket?.underlying);

  useEffect(() => {
    if (open) {
      setStep("underlying");
      setSelectedOvrflo(undefined);
      setSelectedMarket(undefined);
      setAmountStr("");
      setTxPhase("idle");
      setTxHash(undefined);
      setErrorMsg("");
    }
  }, [open]);

  // Advance state on receipt confirmation
  useEffect(() => {
    if (!txHash) return;
    if (receiptConfirmed) {
      if (txPhase === "waiting-pt-approval" || txPhase === "waiting-underlying-approval") {
        setTxPhase("idle");
        setTxHash(undefined);
      } else if (txPhase === "waiting-deposit") {
        setTxPhase("success");
        setTxHash(undefined);
      }
    }
    if (receiptFailed) {
      setTxPhase("error");
      setErrorMsg("Transaction failed on-chain.");
      setTxHash(undefined);
    }
  }, [receiptConfirmed, receiptFailed, txPhase, txHash]);

  const marketsForOvrflo = selectedOvrflo
    ? allMarkets.filter(
        (m) =>
          m.ovrflo.toLowerCase() === selectedOvrflo.address.toLowerCase() &&
          m.expiry > BigInt(Math.floor(Date.now() / 1000))
      )
    : [];

  const ptAmount =
    amountStr && selectedMarket
      ? (() => {
          try {
            return parseUnits(amountStr, ptDecimals);
          } catch {
            return 0n;
          }
        })()
      : 0n;

  const { data: preview } = useReadContract({
    address: selectedOvrflo?.address as Address,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: selectedMarket ? [selectedMarket.market, ptAmount] : undefined,
    query: { enabled: !!selectedMarket && ptAmount > 0n },
  });

  const { data: ptBalance } = useReadContract({
    address: selectedMarket?.ptToken as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!selectedMarket },
  });

  const { data: ptAllowance } = useReadContract({
    address: selectedMarket?.ptToken as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && selectedOvrflo
        ? [address, selectedOvrflo.address as Address]
        : undefined,
    query: { enabled: !!address && !!selectedOvrflo && !!selectedMarket },
  });

  const { data: underlyingAllowance } = useReadContract({
    address: selectedMarket?.underlying as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && selectedOvrflo
        ? [address, selectedOvrflo.address as Address]
        : undefined,
    query: { enabled: !!address && !!selectedOvrflo && !!selectedMarket },
  });

  const { data: underlyingSymbol } = useReadContract({
    address: selectedMarket?.underlying as Address,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!selectedMarket },
  });

  const needsPtApproval =
    ptAllowance !== undefined && ptAmount > 0n && ptAllowance < ptAmount;
  const feeAmount = preview ? preview[2] : 0n;
  const needsUnderlyingApproval =
    underlyingAllowance !== undefined &&
    feeAmount > 0n &&
    underlyingAllowance < feeAmount;

  const toUser = preview ? preview[0] : 0n;
  const toStream = preview ? preview[1] : 0n;
  const minToUser =
    toUser > 0n ? (toUser * (10000n - BigInt(slippageBps))) / 10000n : 0n;

  const wrongChain = chainId !== CHAIN_ID;
  const isBusy = txPhase !== "idle" && txPhase !== "success" && txPhase !== "error";

  const handleApprovePt = useCallback(async () => {
    if (!selectedMarket || !selectedOvrflo) return;
    setTxPhase("approving-pt");
    setErrorMsg("");
    try {
      const hash = await writeContractAsync({
        address: selectedMarket.ptToken as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [selectedOvrflo.address as Address, ptAmount],
      });
      setTxHash(hash);
      setTxPhase("waiting-pt-approval");
    } catch (e: unknown) {
      setTxPhase("error");
      setErrorMsg(e instanceof Error ? e.message.slice(0, 120) : "Approval failed");
    }
  }, [selectedMarket, selectedOvrflo, ptAmount, writeContractAsync]);

  const handleApproveUnderlying = useCallback(async () => {
    if (!selectedMarket || !selectedOvrflo || !feeAmount) return;
    setTxPhase("approving-underlying");
    setErrorMsg("");
    try {
      const hash = await writeContractAsync({
        address: selectedMarket.underlying as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [selectedOvrflo.address as Address, feeAmount],
      });
      setTxHash(hash);
      setTxPhase("waiting-underlying-approval");
    } catch (e: unknown) {
      setTxPhase("error");
      setErrorMsg(e instanceof Error ? e.message.slice(0, 120) : "Approval failed");
    }
  }, [selectedMarket, selectedOvrflo, feeAmount, writeContractAsync]);

  const handleDeposit = useCallback(async () => {
    if (!selectedOvrflo || !selectedMarket) return;
    setTxPhase("creating");
    setErrorMsg("");
    try {
      const hash = await writeContractAsync({
        address: selectedOvrflo.address as Address,
        abi: ovrfloAbi,
        functionName: "deposit",
        args: [selectedMarket.market, ptAmount, minToUser],
      });
      setTxHash(hash);
      setTxPhase("waiting-deposit");
    } catch (e: unknown) {
      setTxPhase("error");
      setErrorMsg(e instanceof Error ? e.message.slice(0, 120) : "Deposit failed");
    }
  }, [selectedOvrflo, selectedMarket, ptAmount, minToUser, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--color-heading)]">
            New OVRFLO
          </h3>
          <div className="flex items-center gap-3">
            <SlippageSettings
              slippageBps={slippageBps}
              onChange={setSlippageBps}
            />
            <button
              onClick={onClose}
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)]"
            >
              ✕
            </button>
          </div>
        </div>

        {step === "underlying" && (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--color-muted)]">
              Select Underlying
            </label>
            {ovrflos.map((o) => (
              <button
                key={o.address}
                onClick={() => {
                  setSelectedOvrflo(o);
                  setStep("maturity");
                }}
                className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors text-[var(--color-heading)]"
              >
                {o.underlying.slice(0, 6)}...{o.underlying.slice(-4)}
              </button>
            ))}
          </div>
        )}

        {step === "maturity" && selectedOvrflo && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                setStep("underlying");
                setSelectedOvrflo(undefined);
              }}
              className="text-sm text-[var(--color-accent)] mb-2"
            >
              ← Back
            </button>
            <label className="text-sm text-[var(--color-muted)]">
              Select Maturity
            </label>
            {marketsForOvrflo.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">
                No active markets.
              </p>
            )}
            {marketsForOvrflo.map((m) => (
              <button
                key={m.market}
                onClick={() => {
                  setSelectedMarket(m);
                  setStep("amount");
                }}
                className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
              >
                <span className="text-[var(--color-heading)]">
                  {m.ptToken.slice(0, 6)}...{m.ptToken.slice(-4)}
                </span>
                <span className="text-xs text-[var(--color-muted)] ml-2">
                  Expires:{" "}
                  {new Date(Number(m.expiry) * 1000).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === "amount" && selectedOvrflo && selectedMarket && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setStep("maturity");
                setSelectedMarket(undefined);
                setAmountStr("");
              }}
              className="text-sm text-[var(--color-accent)] mb-1"
            >
              ← Back
            </button>

            <label className="text-sm text-[var(--color-muted)]">
              Amount (PT)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-heading)] mono"
              />
              {ptBalance !== undefined && (
                <span className="text-xs text-[var(--color-muted)]">
                  Bal: {formatUnits(ptBalance, ptDecimals)}
                </span>
              )}
            </div>

            {preview && ptAmount > 0n && (
              <div className="border-t border-[var(--color-border)] pt-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Immediate</span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(toUser, ptDecimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Streamed</span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(toStream, ptDecimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">
                    Fee ({underlyingSymbol ?? ""})
                  </span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(feeAmount, underlyingDecimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">
                    Min received ({slippageBps / 100}%)
                  </span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(minToUser, ptDecimals)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">
                    Stream ends
                  </span>
                  <span className="text-[var(--color-heading)]">
                    {new Date(
                      Number(selectedMarket.expiry) * 1000
                    ).toLocaleDateString()}
                  </span>
                </div>
                {selectedMarket.expiry -
                  BigInt(Math.floor(Date.now() / 1000)) <
                  86400n && (
                  <div className="text-yellow-400 text-xs">
                    ⚠ Market matures soon (&lt; 24h)
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 mt-2">
              {wrongChain && (
                <p className="text-red-400 text-sm">
                  Switch to chain {CHAIN_ID} first.
                </p>
              )}

              {txPhase === "success" ? (
                <p className="text-green-400 text-sm text-center py-2">
                  Deposit confirmed! Stream will appear shortly.
                </p>
              ) : (
                <>
                  {(txPhase === "waiting-pt-approval" ||
                    txPhase === "waiting-underlying-approval" ||
                    txPhase === "waiting-deposit") && (
                    <p className="text-yellow-400 text-sm text-center py-1">
                      Waiting for on-chain confirmation...
                    </p>
                  )}

                  {needsPtApproval && (
                    <button
                      onClick={handleApprovePt}
                      disabled={wrongChain || isBusy}
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
                    >
                      {txPhase === "approving-pt"
                        ? "Submitting PT Approval..."
                        : txPhase === "waiting-pt-approval"
                          ? "Confirming..."
                          : "Approve PT"}
                    </button>
                  )}

                  {!needsPtApproval && needsUnderlyingApproval && (
                    <button
                      onClick={handleApproveUnderlying}
                      disabled={wrongChain || isBusy}
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
                    >
                      {txPhase === "approving-underlying"
                        ? `Submitting ${underlyingSymbol ?? ""} Approval...`
                        : txPhase === "waiting-underlying-approval"
                          ? "Confirming..."
                          : `Approve ${underlyingSymbol ?? ""}`}
                    </button>
                  )}

                  {!needsPtApproval && !needsUnderlyingApproval && (
                    <button
                      onClick={handleDeposit}
                      disabled={wrongChain || isBusy || ptAmount === 0n}
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
                    >
                      {txPhase === "creating"
                        ? "Submitting..."
                        : txPhase === "waiting-deposit"
                          ? "Confirming..."
                          : "Create OVRFLO"}
                    </button>
                  )}
                </>
              )}

              {txPhase === "error" && (
                <div className="text-red-400 text-xs break-all">
                  {errorMsg}
                  <button
                    onClick={() => {
                      setTxPhase("idle");
                      setTxHash(undefined);
                    }}
                    className="ml-2 underline"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
