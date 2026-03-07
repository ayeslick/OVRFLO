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
import { parseUserError } from "@/lib/tx-errors";
import { useTokenDecimals, getDecimals } from "@/hooks/useTokenMeta";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { useUsdPrices, getTokenUsd, formatUsdValue } from "@/hooks/useUsdPrices";
import { SlippageSettings } from "./SlippageSettings";
import { WalletActionCta } from "./WalletActionCta";
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

function formatAddress(address: `0x${string}`) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

  const decMap = useTokenDecimals([
    selectedMarket?.ptToken,
    selectedMarket?.underlying,
    selectedMarket?.ovrfloToken,
  ]);
  const symbolMap = useTokenSymbols([
    ...ovrflos.map((ovrflo) => ovrflo.underlying),
    ...allMarkets.map((market) => market.ptToken),
  ]);
  const { data: usdPrices } = useUsdPrices([
    selectedMarket?.ptToken,
    selectedMarket?.underlying,
  ]);

  const ptDecimals = getDecimals(decMap, selectedMarket?.ptToken);
  const underlyingDecimals = getDecimals(decMap, selectedMarket?.underlying);
  const now = BigInt(Math.floor(Date.now() / 1000));

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
        (market) =>
          market.ovrflo.toLowerCase() === selectedOvrflo.address.toLowerCase() &&
          market.expiry > now
      )
    : [];

  const selectedMarketExpired = selectedMarket ? selectedMarket.expiry <= now : false;
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
    query: { enabled: !!selectedMarket && ptAmount > 0n && !selectedMarketExpired },
  });

  const { data: ptBalance } = useReadContract({
    address: selectedMarket?.ptToken as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!selectedMarket },
  });

  const { data: underlyingBalance } = useReadContract({
    address: selectedMarket?.underlying as Address,
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

  const underlyingSymbol = getTokenSymbol(symbolMap, selectedMarket?.underlying, undefined);
  const ptSymbol = getTokenSymbol(symbolMap, selectedMarket?.ptToken, undefined);

  const feeAmount = preview ? preview[2] : 0n;
  const toUser = preview ? preview[0] : 0n;
  const toStream = preview ? preview[1] : 0n;
  const minToUser =
    toUser > 0n ? (toUser * (10000n - BigInt(slippageBps))) / 10000n : 0n;
  const wrongChain = !!address && chainId !== CHAIN_ID;
  const isBusy = txPhase !== "idle" && txPhase !== "success" && txPhase !== "error";
  const insufficientPtBalance = ptBalance !== undefined && ptAmount > ptBalance;
  const insufficientUnderlyingBalance =
    underlyingBalance !== undefined && feeAmount > 0n && feeAmount > underlyingBalance;
  const needsPtApproval =
    !selectedMarketExpired &&
    ptAllowance !== undefined &&
    ptAmount > 0n &&
    ptAllowance < ptAmount;
  const needsUnderlyingApproval =
    !selectedMarketExpired &&
    underlyingAllowance !== undefined &&
    feeAmount > 0n &&
    underlyingAllowance < feeAmount;
  const ptUsd = getTokenUsd(usdPrices?.tokenUsd, selectedMarket?.ptToken);
  const underlyingUsd = getTokenUsd(usdPrices?.tokenUsd, selectedMarket?.underlying);
  const inputUsd = ptAmount > 0n ? formatUsdValue(ptAmount, ptDecimals, ptUsd) : undefined;
  const immediateUsd = toUser > 0n ? formatUsdValue(toUser, ptDecimals, ptUsd) : undefined;
  const streamedUsd = toStream > 0n ? formatUsdValue(toStream, ptDecimals, ptUsd) : undefined;
  const feeUsd = feeAmount > 0n ? formatUsdValue(feeAmount, underlyingDecimals, underlyingUsd) : undefined;
  const canProceed =
    !selectedMarketExpired &&
    !insufficientPtBalance &&
    !insufficientUnderlyingBalance &&
    ptAmount > 0n;

  const handleApprovePt = useCallback(async () => {
    if (!selectedMarket || !selectedOvrflo || !canProceed) return;
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
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Approval failed"));
    }
  }, [selectedMarket, selectedOvrflo, canProceed, ptAmount, writeContractAsync]);

  const handleApproveUnderlying = useCallback(async () => {
    if (!selectedMarket || !selectedOvrflo || !feeAmount || !canProceed) return;
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
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Approval failed"));
    }
  }, [selectedMarket, selectedOvrflo, feeAmount, canProceed, writeContractAsync]);

  const handleDeposit = useCallback(async () => {
    if (!selectedOvrflo || !selectedMarket || !canProceed) return;
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
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Deposit failed"));
    }
  }, [selectedOvrflo, selectedMarket, canProceed, ptAmount, minToUser, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--color-heading)]">New OVRFLO</h3>
          <div className="flex items-center gap-3">
            <SlippageSettings slippageBps={slippageBps} onChange={setSlippageBps} />
            <button
              onClick={onClose}
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)]"
              aria-label="Close new OVRFLO modal"
            >
              ✕
            </button>
          </div>
        </div>

        {step === "underlying" && (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--color-muted)]">Select Underlying</label>
            {ovrflos.map((ovrflo) => {
              const symbol = getTokenSymbol(symbolMap, ovrflo.underlying, formatAddress(ovrflo.underlying));
              return (
                <button
                  key={ovrflo.address}
                  onClick={() => {
                    setSelectedOvrflo(ovrflo);
                    setStep("maturity");
                  }}
                  className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
                >
                  <div className="text-[var(--color-heading)] font-semibold">{symbol}</div>
                  <div className="text-xs text-[var(--color-muted)]">{formatAddress(ovrflo.underlying)}</div>
                </button>
              );
            })}
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
            <label className="text-sm text-[var(--color-muted)]">Select Maturity</label>
            {marketsForOvrflo.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">No active markets.</p>
            )}
            {marketsForOvrflo.map((market) => {
              const symbol = getTokenSymbol(symbolMap, market.ptToken, formatAddress(market.ptToken));
              return (
                <button
                  key={market.market}
                  onClick={() => {
                    setSelectedMarket(market);
                    setStep("amount");
                  }}
                  className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
                >
                  <div className="text-[var(--color-heading)] font-semibold">{symbol}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    Expires: {new Date(Number(market.expiry) * 1000).toLocaleDateString()} · {formatAddress(market.market)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {step === "amount" && selectedOvrflo && selectedMarket && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setStep("maturity");
                setSelectedMarket(undefined);
                setAmountStr("");
                setErrorMsg("");
              }}
              className="text-sm text-[var(--color-accent)] mb-1"
            >
              ← Back
            </button>

            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Underlying</span>
                <span className="text-[var(--color-heading)]">{getTokenSymbol(symbolMap, selectedOvrflo.underlying, formatAddress(selectedOvrflo.underlying))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Maturity</span>
                <span className="text-[var(--color-heading)]">{new Date(Number(selectedMarket.expiry) * 1000).toLocaleDateString()}</span>
              </div>
            </div>

            <label className="text-sm text-[var(--color-muted)]">Amount ({ptSymbol})</label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={amountStr}
                onChange={(event) => {
                  setAmountStr(event.target.value);
                  setErrorMsg("");
                }}
                placeholder="0.0"
                className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-heading)] mono"
              />
              {ptBalance !== undefined && (
                <span className="text-xs text-[var(--color-muted)]">Bal: {formatUnits(ptBalance, ptDecimals)}</span>
              )}
            </div>
            {inputUsd && <p className="text-xs text-[var(--color-muted)]">≈ {inputUsd}</p>}

            {preview && ptAmount > 0n && !selectedMarketExpired && (
              <div className="border-t border-[var(--color-border)] pt-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Immediate</span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(toUser, ptDecimals)}{immediateUsd ? ` (${immediateUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Streamed</span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(toStream, ptDecimals)}{streamedUsd ? ` (${streamedUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Fee ({underlyingSymbol})</span>
                  <span className="mono text-[var(--color-heading)]">
                    {formatUnits(feeAmount, underlyingDecimals)}{feeUsd ? ` (${feeUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Min received ({slippageBps / 100}%)</span>
                  <span className="mono text-[var(--color-heading)]">{formatUnits(minToUser, ptDecimals)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Stream ends</span>
                  <span className="text-[var(--color-heading)]">{new Date(Number(selectedMarket.expiry) * 1000).toLocaleDateString()}</span>
                </div>
                {selectedMarket.expiry - now < 86400n && (
                  <div className="text-yellow-400 text-xs">Market matures soon (&lt; 24h)</div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 mt-2">
              {!address ? (
                <>
                  <p className="text-sm text-[var(--color-muted)]">Connect your wallet to continue.</p>
                  <WalletActionCta />
                </>
              ) : wrongChain ? (
                <>
                  <p className="text-red-400 text-sm">Switch to chain {CHAIN_ID} to continue.</p>
                  <WalletActionCta />
                </>
              ) : selectedMarketExpired ? (
                <p className="text-red-400 text-sm">This market expired while the modal was open.</p>
              ) : txPhase === "success" ? (
                <p className="text-green-400 text-sm text-center py-2">Deposit confirmed! Stream will appear shortly.</p>
              ) : (
                <>
                  {(txPhase === "waiting-pt-approval" ||
                    txPhase === "waiting-underlying-approval" ||
                    txPhase === "waiting-deposit") && (
                    <p className="text-yellow-400 text-sm text-center py-1">Waiting for on-chain confirmation...</p>
                  )}

                  {insufficientPtBalance && (
                    <p className="text-red-400 text-xs">Insufficient {ptSymbol} balance for this deposit.</p>
                  )}
                  {insufficientUnderlyingBalance && feeAmount > 0n && (
                    <p className="text-red-400 text-xs">Insufficient {underlyingSymbol} balance to pay the deposit fee.</p>
                  )}

                  {needsPtApproval ? (
                    <button
                      onClick={handleApprovePt}
                      disabled={!canProceed || isBusy}
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
                    >
                      {txPhase === "approving-pt"
                        ? `Submitting ${ptSymbol} approval...`
                        : txPhase === "waiting-pt-approval"
                          ? "Confirming..."
                          : `Approve ${ptSymbol}`}
                    </button>
                  ) : needsUnderlyingApproval ? (
                    <button
                      onClick={handleApproveUnderlying}
                      disabled={!canProceed || isBusy}
                      className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
                    >
                      {txPhase === "approving-underlying"
                        ? `Submitting ${underlyingSymbol} approval...`
                        : txPhase === "waiting-underlying-approval"
                          ? "Confirming..."
                          : `Approve ${underlyingSymbol}`}
                    </button>
                  ) : (
                    <button
                      onClick={handleDeposit}
                      disabled={!canProceed || isBusy}
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
                      setErrorMsg("");
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
