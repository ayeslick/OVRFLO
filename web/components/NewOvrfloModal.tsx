"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/constants";
import { erc20Abi, ovrfloAbi } from "@/lib/contracts";
import { getDecimals, useTokenDecimals } from "@/hooks/useTokenMeta";
import { getTokenSymbol, useTokenSymbols } from "@/hooks/useTokenLabels";
import { parseUserError } from "@/lib/tx-errors";
import { SlippageSettings } from "./SlippageSettings";
import { WalletActionCta } from "./WalletActionCta";
import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MockCreateFlowData } from "@/lib/mock-dashboard";

interface CreatePreviewProps {
  tokenLabels: Record<`0x${string}`, string>;
  marketLabels: Record<`0x${string}`, string>;
  createFlows: Record<`0x${string}`, MockCreateFlowData>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  preview?: CreatePreviewProps;
}

type Step = "underlying" | "maturity";
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

function formatAddress(address?: `0x${string}`) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Token";
}

function formatDate(value?: bigint) {
  return value ? new Date(Number(value) * 1000).toLocaleDateString() : "--";
}

function lookupLabel(
  labels: Record<`0x${string}`, string> | undefined,
  address: `0x${string}` | undefined,
  fallback: string,
) {
  return address ? labels?.[address] ?? fallback : fallback;
}

function sanitizeAmount(value: string) {
  return value.replace(/[^0-9.]/g, "");
}

export function NewOvrfloModal({ open, onClose, ovrflos, allMarkets, preview }: Props) {
  const previewMode = Boolean(preview);
  const { address, chainId } = useAccount();
  const [step, setStep] = useState<Step>("underlying");
  const [selectedOvrflo, setSelectedOvrflo] = useState<OvrfloEntry>();
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo>();
  const [amountStr, setAmountStr] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [unlimitedApproval, setUnlimitedApproval] = useState(false);
  const [previewPtApproved, setPreviewPtApproved] = useState(false);
  const [previewUnderlyingApproved, setPreviewUnderlyingApproved] = useState(false);
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: receiptConfirmed, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  const symbolMap = useTokenSymbols(
    previewMode ? [] : [...ovrflos.map((ovrflo) => ovrflo.underlying), ...allMarkets.map((market) => market.ptToken)],
  );
  const decMap = useTokenDecimals(previewMode ? [] : [selectedMarket?.ptToken, selectedMarket?.underlying, selectedMarket?.ovrfloToken]);
  const now = BigInt(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!open) return;
    setStep("underlying");
    setSelectedOvrflo(undefined);
    setSelectedMarket(undefined);
    setAmountStr("");
    setSlippageBps(50);
    setUnlimitedApproval(false);
    setPreviewPtApproved(false);
    setPreviewUnderlyingApproved(false);
    setTxPhase("idle");
    setTxHash(undefined);
    setErrorMsg("");
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
  }, [receiptConfirmed, receiptFailed, txHash, txPhase]);

  useEffect(() => {
    if (!previewMode) return;
    setPreviewPtApproved(false);
    setPreviewUnderlyingApproved(false);
    setTxPhase((current) => (current === "success" ? "idle" : current));
  }, [amountStr, previewMode, selectedMarket?.market, unlimitedApproval]);

  const marketsForOvrflo = selectedOvrflo
    ? allMarkets.filter(
        (market) => market.ovrflo.toLowerCase() === selectedOvrflo.address.toLowerCase() && market.expiry > now,
      )
    : [];

  const { data: seriesData } = useReadContract({
    address: selectedOvrflo?.address as Address,
    abi: ovrfloAbi,
    functionName: "series",
    args: selectedMarket ? [selectedMarket.market] : undefined,
    query: { enabled: !previewMode && !!selectedOvrflo && !!selectedMarket },
  });

  const resolvedExpiry = (seriesData?.[3] as bigint | undefined) ?? selectedMarket?.expiry;
  const resolvedPtToken = (seriesData?.[4] as `0x${string}` | undefined) ?? selectedMarket?.ptToken;
  const resolvedOvrfloToken = (seriesData?.[5] as `0x${string}` | undefined) ?? selectedMarket?.ovrfloToken;
  const resolvedUnderlying = (seriesData?.[6] as `0x${string}` | undefined) ?? selectedMarket?.underlying;

  const ptDecimals = getDecimals(decMap, resolvedPtToken);
  const underlyingDecimals = getDecimals(decMap, resolvedUnderlying);
  const ovrfloDecimals = getDecimals(decMap, resolvedOvrfloToken);
  const selectedMarketExpired = resolvedExpiry ? resolvedExpiry <= now : false;
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

  const { data: previewDeposit } = useReadContract({
    address: selectedOvrflo?.address as Address,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: selectedMarket ? [selectedMarket.market, ptAmount] : undefined,
    query: { enabled: !previewMode && !!selectedOvrflo && !!selectedMarket && ptAmount > 0n && !selectedMarketExpired },
  });

  const { data: ptBalance } = useReadContract({
    address: resolvedPtToken as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !previewMode && !!address && !!resolvedPtToken },
  });

  const { data: underlyingBalance } = useReadContract({
    address: resolvedUnderlying as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !previewMode && !!address && !!resolvedUnderlying },
  });

  const { data: ptAllowance } = useReadContract({
    address: resolvedPtToken as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && selectedOvrflo ? [address, selectedOvrflo.address as Address] : undefined,
    query: { enabled: !previewMode && !!address && !!selectedOvrflo && !!resolvedPtToken },
  });

  const { data: underlyingAllowance } = useReadContract({
    address: resolvedUnderlying as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && selectedOvrflo ? [address, selectedOvrflo.address as Address] : undefined,
    query: { enabled: !previewMode && !!address && !!selectedOvrflo && !!resolvedUnderlying },
  });

  const previewFlow = selectedMarket ? preview?.createFlows[selectedMarket.market] : undefined;
  const underlyingLabel = lookupLabel(
    preview?.tokenLabels,
    resolvedUnderlying ?? selectedOvrflo?.underlying,
    getTokenSymbol(symbolMap, resolvedUnderlying ?? selectedOvrflo?.underlying, formatAddress(resolvedUnderlying ?? selectedOvrflo?.underlying)),
  );
  const ptSymbol = lookupLabel(
    preview?.tokenLabels,
    resolvedPtToken,
    getTokenSymbol(symbolMap, resolvedPtToken, formatAddress(resolvedPtToken)),
  );
  const ovrfloSymbol = lookupLabel(preview?.tokenLabels, resolvedOvrfloToken, formatAddress(resolvedOvrfloToken));
  const marketLabel = selectedMarket
    ? lookupLabel(preview?.marketLabels, selectedMarket.market, `${ptSymbol} ${formatDate(resolvedExpiry)}`)
    : "";

  const toUser = previewDeposit?.[0] ?? 0n;
  const toStream = previewDeposit?.[1] ?? 0n;
  const feeAmount = previewDeposit?.[2] ?? 0n;
  const minToUser = toUser > 0n ? (toUser * (10000n - BigInt(slippageBps))) / 10000n : 0n;
  const wrongChain = !previewMode && !!address && chainId !== CHAIN_ID;
  const isBusy = txPhase !== "idle" && txPhase !== "success" && txPhase !== "error";
  const insufficientPtBalance = !previewMode && ptBalance !== undefined && ptAmount > ptBalance;
  const insufficientUnderlyingBalance =
    !previewMode && underlyingBalance !== undefined && feeAmount > 0n && feeAmount > underlyingBalance;
  const needsPtApproval =
    !selectedMarketExpired &&
    (previewMode
      ? Boolean(previewFlow?.needsPtApproval) && !previewPtApproved
      : ptAllowance !== undefined && ptAmount > 0n && ptAllowance < ptAmount);
  const needsUnderlyingApproval =
    !selectedMarketExpired &&
    !needsPtApproval &&
    (previewMode
      ? Boolean(previewFlow?.needsUnderlyingApproval) && !previewUnderlyingApproved
      : underlyingAllowance !== undefined && feeAmount > 0n && underlyingAllowance < feeAmount);
  const canProceed =
    Boolean(selectedMarket) &&
    ptAmount > 0n &&
    !selectedMarketExpired &&
    !insufficientPtBalance &&
    !insufficientUnderlyingBalance;
  const maturingSoon =
    Boolean(previewFlow?.marketMaturesSoon) ||
    (!selectedMarketExpired && resolvedExpiry !== undefined && resolvedExpiry - now < 86400n);

  const handleApprovePt = useCallback(async () => {
    if (!selectedOvrflo || !resolvedPtToken || !canProceed) return;
    setErrorMsg("");

    if (previewMode) {
      setPreviewPtApproved(true);
      return;
    }

    setTxPhase("approving-pt");
    try {
      const hash = await writeContractAsync({
        address: resolvedPtToken as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [selectedOvrflo.address as Address, unlimitedApproval ? maxUint256 : ptAmount],
      });
      setTxHash(hash);
      setTxPhase("waiting-pt-approval");
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "PT approval failed"));
    }
  }, [canProceed, previewMode, ptAmount, resolvedPtToken, selectedOvrflo, unlimitedApproval, writeContractAsync]);

  const handleApproveUnderlying = useCallback(async () => {
    if (!selectedOvrflo || !resolvedUnderlying || !canProceed || feeAmount <= 0n) return;
    setErrorMsg("");

    if (previewMode) {
      setPreviewUnderlyingApproved(true);
      return;
    }

    setTxPhase("approving-underlying");
    try {
      const hash = await writeContractAsync({
        address: resolvedUnderlying as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [selectedOvrflo.address as Address, unlimitedApproval ? maxUint256 : feeAmount],
      });
      setTxHash(hash);
      setTxPhase("waiting-underlying-approval");
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Underlying approval failed"));
    }
  }, [canProceed, feeAmount, previewMode, resolvedUnderlying, selectedOvrflo, unlimitedApproval, writeContractAsync]);

  const handleDeposit = useCallback(async () => {
    if (!selectedOvrflo || !selectedMarket || !canProceed) return;
    setErrorMsg("");

    if (previewMode) {
      setTxPhase("success");
      return;
    }

    setTxPhase("creating");
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
      setErrorMsg(parseUserError(error, "Create failed"));
    }
  }, [canProceed, minToUser, previewMode, ptAmount, selectedMarket, selectedOvrflo, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="nb-panel relative w-full max-w-xl rounded-[4px] p-6 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-xl text-[var(--color-ink)]">New OVRFLO</h3>
          <div className="flex items-center gap-3">
            <SlippageSettings slippageBps={slippageBps} onChange={setSlippageBps} />
            <button type="button" onClick={onClose} className="nb-icon-button" aria-label="Close new OVRFLO modal">
              ✕
            </button>
          </div>
        </div>

        {step === "underlying" ? (
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <label htmlFor="new-ovrflo-underlying" className="nb-kicker block text-[var(--color-border)]">
                Underlying
              </label>
              <select
                id="new-ovrflo-underlying"
                value={selectedOvrflo?.address ?? ""}
                onChange={(event) => {
                  const next = ovrflos.find((ovrflo) => ovrflo.address === event.target.value);
                  setSelectedOvrflo(next);
                }}
                className="nb-input nb-select min-h-12 w-full"
              >
                <option value="">Select underlying</option>
                {ovrflos.map((ovrflo) => (
                  <option key={ovrflo.address} value={ovrflo.address}>
                    {lookupLabel(
                      preview?.tokenLabels,
                      ovrflo.underlying,
                      getTokenSymbol(symbolMap, ovrflo.underlying, formatAddress(ovrflo.underlying)),
                    )}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" disabled={!selectedOvrflo} onClick={() => setStep("maturity")} className="nb-button w-full">
              Continue
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => {
                setStep("underlying");
                setSelectedMarket(undefined);
                setAmountStr("");
                setErrorMsg("");
              }}
              className="nb-link w-fit text-[var(--color-border)]"
            >
              ← {underlyingLabel}
            </button>

            <div className="space-y-2">
              <label htmlFor="new-ovrflo-maturity" className="nb-kicker block text-[var(--color-border)]">
                Maturity
              </label>
              <select
                id="new-ovrflo-maturity"
                value={selectedMarket?.market ?? ""}
                onChange={(event) => {
                  const next = marketsForOvrflo.find((market) => market.market === event.target.value);
                  setSelectedMarket(next);
                  setAmountStr("");
                  setUnlimitedApproval(false);
                  setPreviewPtApproved(false);
                  setPreviewUnderlyingApproved(false);
                  setTxPhase("idle");
                  setTxHash(undefined);
                  setErrorMsg("");
                }}
                className="nb-input nb-select min-h-12 w-full"
              >
                <option value="">Select maturity</option>
                {marketsForOvrflo.map((market) => (
                  <option key={market.market} value={market.market}>
                    {lookupLabel(preview?.marketLabels, market.market, `${getTokenSymbol(symbolMap, market.ptToken, "PT")} ${formatDate(market.expiry)}`)}
                  </option>
                ))}
              </select>
            </div>

            {selectedMarket ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="new-ovrflo-amount" className="nb-kicker text-[var(--color-border)]">
                      Amount (PT)
                    </label>
                    <span className="text-xs text-[var(--color-ink)]/70">Balance: {previewFlow?.ptBalance ?? (ptBalance !== undefined ? `${formatUnits(ptBalance, ptDecimals)} ${ptSymbol}` : "--")}</span>
                  </div>
                  <input
                    id="new-ovrflo-amount"
                    type="text"
                    inputMode="decimal"
                    value={amountStr}
                    onChange={(event) => {
                      setAmountStr(sanitizeAmount(event.target.value));
                      setErrorMsg("");
                    }}
                    placeholder="0.0"
                    className="nb-input mono w-full"
                  />
                </div>

                <div className="grid gap-2 rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm shadow-[var(--shadow-hard-sm)]">
                  <div className="flex justify-between gap-4">
                    <span className="nb-kicker text-[var(--color-border)]">Immediate</span>
                    <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                      {previewFlow?.immediate ?? (toUser > 0n ? `${formatUnits(toUser, underlyingDecimals)} ${underlyingLabel}` : "--")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="nb-kicker text-[var(--color-border)]">Streamed</span>
                    <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                      {previewFlow?.streamed ?? (toStream > 0n ? `${formatUnits(toStream, ovrfloDecimals)} ${ovrfloSymbol}` : "--")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="nb-kicker text-[var(--color-border)]">Fee</span>
                    <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                      {previewFlow?.fee ?? (feeAmount > 0n ? `${formatUnits(feeAmount, underlyingDecimals)} ${underlyingLabel}` : `0 ${underlyingLabel}`)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="nb-kicker text-[var(--color-border)]">Min received</span>
                    <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                      {previewFlow?.minReceived ?? (minToUser > 0n ? `${formatUnits(minToUser, underlyingDecimals)} ${underlyingLabel}` : "--")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="nb-kicker text-[var(--color-border)]">Stream ends</span>
                    <span className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                      {previewFlow?.streamEnds ?? formatDate(resolvedExpiry)}
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-3 text-sm text-[var(--color-ink)]">
                  <input
                    type="checkbox"
                    checked={unlimitedApproval}
                    onChange={(event) => setUnlimitedApproval(event.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  Unlimited approvals
                </label>

                {maturingSoon ? <div className="nb-status nb-status-warning text-xs">Market matures soon (&lt; 24h).</div> : null}
                {selectedMarketExpired ? <div className="nb-status nb-status-error text-xs">Market expired.</div> : null}
                {insufficientPtBalance ? <div className="nb-status nb-status-error text-xs">Insufficient PT balance.</div> : null}
                {insufficientUnderlyingBalance ? <div className="nb-status nb-status-error text-xs">Insufficient {underlyingLabel} balance.</div> : null}

                {!previewMode && !address ? (
                  <>
                    <div className="nb-status nb-status-info text-sm">Connect wallet.</div>
                    <WalletActionCta />
                  </>
                ) : wrongChain ? (
                  <>
                    <div className="nb-status nb-status-error text-sm">Switch to chain {CHAIN_ID}.</div>
                    <WalletActionCta />
                  </>
                ) : txPhase === "success" ? (
                  <div className="nb-status nb-status-success text-center text-sm">Created.</div>
                ) : (
                  <>
                    {(txPhase === "waiting-pt-approval" || txPhase === "waiting-underlying-approval" || txPhase === "waiting-deposit") ? (
                      <div className="nb-status nb-status-warning text-center text-sm">Confirming…</div>
                    ) : null}

                    {needsPtApproval ? (
                      <button type="button" onClick={handleApprovePt} disabled={!canProceed || isBusy} className="nb-button w-full">
                        {txPhase === "approving-pt"
                          ? "Submitting…"
                          : txPhase === "waiting-pt-approval"
                            ? "Confirming…"
                            : "Approve PT"}
                      </button>
                    ) : needsUnderlyingApproval ? (
                      <button type="button" onClick={handleApproveUnderlying} disabled={!canProceed || isBusy} className="nb-button w-full">
                        {txPhase === "approving-underlying"
                          ? "Submitting…"
                          : txPhase === "waiting-underlying-approval"
                            ? "Confirming…"
                            : `Approve ${underlyingLabel}`}
                      </button>
                    ) : (
                      <button type="button" onClick={handleDeposit} disabled={!canProceed || isBusy} className="nb-button w-full">
                        {txPhase === "creating"
                          ? "Submitting…"
                          : txPhase === "waiting-deposit"
                            ? "Confirming…"
                            : "Create OVRFLO"}
                      </button>
                    )}
                  </>
                )}

                {txPhase === "error" ? (
                  <div className="nb-status nb-status-error break-all text-xs">
                    {errorMsg}
                    <button
                      type="button"
                      onClick={() => {
                        setTxPhase("idle");
                        setTxHash(undefined);
                        setErrorMsg("");
                      }}
                      className="nb-link ml-2 inline-block"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}

                <div className="text-xs text-[var(--color-ink)]/70">{marketLabel}</div>
              </>
            ) : marketsForOvrflo.length === 0 ? (
              <div className="nb-status nb-status-info text-sm">No maturities.</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
