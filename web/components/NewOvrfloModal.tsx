"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/config";
import { erc20Abi, ovrfloAbi } from "@/lib/contracts";
import { getDecimals, useTokenDecimals } from "@/hooks/useTokenMeta";
import { getTokenSymbol, useTokenSymbols } from "@/hooks/useTokenLabels";
import {
  formatUsdValue,
  getOvrfloUsdForMarket,
  getUnderlyingUsd,
  type UsdPrices,
} from "@/hooks/useUsdPrices";
import { parseUserError } from "@/lib/tx-errors";
import { SlippageSettings } from "./SlippageSettings";
import { WalletActionCta } from "./WalletActionCta";
import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { OvrfloEntry } from "@/hooks/useOvrflos";

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  prices?: UsdPrices;
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
  return value
    ? new Date(Number(value) * 1000).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "--";
}

function sanitizeAmount(value: string) {
  return value.replace(/[^0-9.]/g, "");
}

export function NewOvrfloModal({ open, onClose, ovrflos, allMarkets, prices }: Props) {
  const { address, chainId } = useAccount();
  const [step, setStep] = useState<Step>("underlying");
  const [selectedOvrflo, setSelectedOvrflo] = useState<OvrfloEntry>();
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo>();
  const [amountStr, setAmountStr] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [unlimitedApproval, setUnlimitedApproval] = useState(false);
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: receiptConfirmed, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  const symbolMap = useTokenSymbols([
    ...ovrflos.map((o) => o.underlying),
    ...allMarkets.map((m) => m.ptToken),
  ]);
  const decMap = useTokenDecimals([
    selectedMarket?.ptToken,
    selectedMarket?.underlying,
    selectedMarket?.ovrfloToken,
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!open) return;
    setStep("underlying");
    setSelectedOvrflo(undefined);
    setSelectedMarket(undefined);
    setAmountStr("");
    setSlippageBps(50);
    setUnlimitedApproval(false);
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
    query: { enabled: !!selectedOvrflo && !!selectedMarket },
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
    query: { enabled: !!selectedOvrflo && !!selectedMarket && ptAmount > 0n && !selectedMarketExpired },
  });

  const { data: ptBalance } = useReadContract({
    address: resolvedPtToken as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!resolvedPtToken },
  });

  const { data: underlyingBalance } = useReadContract({
    address: resolvedUnderlying as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!resolvedUnderlying },
  });

  const { data: ptAllowance } = useReadContract({
    address: resolvedPtToken as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && selectedOvrflo ? [address, selectedOvrflo.address as Address] : undefined,
    query: { enabled: !!address && !!selectedOvrflo && !!resolvedPtToken },
  });

  const { data: underlyingAllowance } = useReadContract({
    address: resolvedUnderlying as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && selectedOvrflo ? [address, selectedOvrflo.address as Address] : undefined,
    query: { enabled: !!address && !!selectedOvrflo && !!resolvedUnderlying },
  });

  const { data: marketTotalDeposited } = useReadContract({
    address: selectedOvrflo?.address as Address,
    abi: ovrfloAbi,
    functionName: "marketTotalDeposited",
    args: selectedMarket ? [selectedMarket.market] : undefined,
    query: { enabled: !!selectedOvrflo && !!selectedMarket },
  });

  const { data: marketDepositLimit } = useReadContract({
    address: selectedOvrflo?.address as Address,
    abi: ovrfloAbi,
    functionName: "marketDepositLimits",
    args: selectedMarket ? [selectedMarket.market] : undefined,
    query: { enabled: !!selectedOvrflo && !!selectedMarket },
  });

  const underlyingLabel = getTokenSymbol(
    symbolMap,
    resolvedUnderlying ?? selectedOvrflo?.underlying,
    formatAddress(resolvedUnderlying ?? selectedOvrflo?.underlying),
  );
  const ptSymbol = getTokenSymbol(symbolMap, resolvedPtToken, formatAddress(resolvedPtToken));
  const ovrfloSymbol = formatAddress(resolvedOvrfloToken);

  const toUser = previewDeposit?.[0] ?? 0n;
  const toStream = previewDeposit?.[1] ?? 0n;
  const feeAmount = previewDeposit?.[2] ?? 0n;
  const minToUser = toUser > 0n ? (toUser * (10000n - BigInt(slippageBps))) / 10000n : 0n;

  const undUsd = getUnderlyingUsd(prices, resolvedUnderlying);
  const ovrfloUsd = getOvrfloUsdForMarket(prices, selectedMarket?.market);
  const toUserUsd = formatUsdValue(toUser, underlyingDecimals, undUsd);
  const toStreamUsd = formatUsdValue(toStream, ovrfloDecimals, ovrfloUsd);
  const feeUsd = formatUsdValue(feeAmount, underlyingDecimals, undUsd);
  const wrongChain = !!address && chainId !== CHAIN_ID;
  const isBusy = txPhase !== "idle" && txPhase !== "success" && txPhase !== "error";
  const insufficientPtBalance = ptBalance !== undefined && ptAmount > ptBalance;
  const insufficientUnderlyingBalance =
    underlyingBalance !== undefined && feeAmount > 0n && feeAmount > underlyingBalance;
  // Mirrors OVRFLO.sol MIN_PT_AMOUNT (1e6).
  const MIN_PT_AMOUNT = 1_000_000n;
  const belowMinPt = ptAmount > 0n && ptAmount < MIN_PT_AMOUNT;
  const exceedsDepositLimit =
    marketDepositLimit !== undefined &&
    marketTotalDeposited !== undefined &&
    marketDepositLimit > 0n &&
    marketTotalDeposited + ptAmount > marketDepositLimit;
  const previewReady = previewDeposit !== undefined && toUser > 0n;
  const nothingToStream = previewDeposit !== undefined && toStream === 0n;
  const needsPtApproval =
    !selectedMarketExpired &&
    ptAllowance !== undefined &&
    ptAmount > 0n &&
    ptAllowance < ptAmount;
  const needsUnderlyingApproval =
    !selectedMarketExpired &&
    !needsPtApproval &&
    underlyingAllowance !== undefined &&
    feeAmount > 0n &&
    underlyingAllowance < feeAmount;
  const canProceed =
    Boolean(selectedMarket) &&
    ptAmount > 0n &&
    !selectedMarketExpired &&
    !insufficientPtBalance &&
    !insufficientUnderlyingBalance &&
    !belowMinPt &&
    !exceedsDepositLimit &&
    !nothingToStream &&
    previewReady;
  const maturingSoon =
    !selectedMarketExpired && resolvedExpiry !== undefined && resolvedExpiry - now < 86400n;

  const handleApprovePt = useCallback(async () => {
    if (!selectedOvrflo || !resolvedPtToken || !canProceed) return;
    setErrorMsg("");
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
  }, [canProceed, ptAmount, resolvedPtToken, selectedOvrflo, unlimitedApproval, writeContractAsync]);

  const handleApproveUnderlying = useCallback(async () => {
    if (!selectedOvrflo || !resolvedUnderlying || !canProceed || feeAmount <= 0n) return;
    setErrorMsg("");
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
  }, [canProceed, feeAmount, resolvedUnderlying, selectedOvrflo, unlimitedApproval, writeContractAsync]);

  const handleDeposit = useCallback(async () => {
    if (!selectedOvrflo || !selectedMarket || !canProceed) return;
    setErrorMsg("");
    if (minToUser === 0n) {
      setTxPhase("error");
      setErrorMsg(
        "Preview unavailable; refusing to deposit without a slippage floor. Please try again."
      );
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
  }, [canProceed, minToUser, ptAmount, selectedMarket, selectedOvrflo, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="nb-modal-overlay" data-testid="modal-new-ovrflo">
      <div className="nb-modal">
        {/* Modal Header */}
        <div className="nb-modal-header">
          <h3 className="text-lg font-bold uppercase tracking-wide text-black">New OVRFLO</h3>
          <div className="flex items-center gap-2">
            <SlippageSettings slippageBps={slippageBps} onChange={setSlippageBps} />
            <button
              type="button"
              onClick={onClose}
              className="nb-icon-button h-9 w-9 text-sm"
              aria-label="Close new OVRFLO modal"
              data-testid="button-close-new-ovrflo"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="nb-modal-body">
          {step === "underlying" ? (
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="new-ovrflo-underlying" className="nb-kicker mb-2 block text-black/40">
                  Select Underlying
                </label>
                <div className="flex flex-col gap-2">
                  {ovrflos.map((ovrflo) => (
                    <button
                      key={ovrflo.address}
                      type="button"
                      onClick={() => {
                        setSelectedOvrflo(ovrflo);
                        setStep("maturity");
                      }}
                      className={`flex w-full items-center justify-between border-2 border-[#000] bg-white p-4 text-left text-sm font-bold uppercase tracking-wider text-black shadow-[var(--shadow-hard-sm)] transition-all hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[var(--shadow-hard-md)] ${
                        selectedOvrflo?.address === ovrflo.address ? "border-[#5dc0f5] bg-[#5dc0f5]/10" : ""
                      }`}
                      data-testid={`button-select-underlying-${ovrflo.address}`}
                    >
                      <span>
                        {getTokenSymbol(symbolMap, ovrflo.underlying, formatAddress(ovrflo.underlying))}
                      </span>
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
                        <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Back button */}
              <button
                type="button"
                onClick={() => {
                  setStep("underlying");
                  setSelectedMarket(undefined);
                  setAmountStr("");
                  setErrorMsg("");
                }}
                className="flex w-fit items-center gap-1 text-sm font-bold uppercase tracking-wider text-black/40 hover:text-[#5dc0f5]"
                data-testid="button-back-underlying"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                  <path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
                </svg>
                {underlyingLabel}
              </button>

              {/* Maturity select */}
              <div>
                <label htmlFor="new-ovrflo-maturity" className="nb-kicker mb-2 block text-black/40">
                  Select Maturity
                </label>
                <select
                  id="new-ovrflo-maturity"
                  value={selectedMarket?.market ?? ""}
                  onChange={(event) => {
                    const next = marketsForOvrflo.find((market) => market.market === event.target.value);
                    setSelectedMarket(next);
                    setAmountStr("");
                    setUnlimitedApproval(false);
                    setTxPhase("idle");
                    setTxHash(undefined);
                    setErrorMsg("");
                  }}
                  className="nb-input nb-select w-full"
                  data-testid="select-maturity"
                >
                  <option value="">Select maturity</option>
                  {marketsForOvrflo.map((market) => (
                    <option key={market.market} value={market.market}>
                      {`${getTokenSymbol(symbolMap, market.ptToken, "PT")} ${formatDate(market.expiry)}`}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMarket ? (
                <>
                  {/* Amount */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="new-ovrflo-amount" className="nb-kicker text-black/40">
                        Amount (PT)
                      </label>
                      <span className="mono text-xs font-semibold text-black/50">
                        Balance: {ptBalance !== undefined ? `${formatUnits(ptBalance, ptDecimals)} ${ptSymbol}` : "--"}
                      </span>
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
                      data-testid="input-pt-amount"
                    />
                  </div>

                  {/* Preview section */}
                  <div className="nb-preview-box">
                    <p className="nb-kicker mb-3 text-center text-black/40">Preview</p>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Immediate</span>
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>
                          {toUser > 0n ? `${formatUnits(toUser, underlyingDecimals)} ${underlyingLabel}` : "--"}
                        </span>
                        {toUserUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-immediate">
                            {toUserUsd}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Streamed</span>
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>
                          {toStream > 0n ? `${formatUnits(toStream, ovrfloDecimals)} ${ovrfloSymbol}` : "--"}
                        </span>
                        {toStreamUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-streamed">
                            {toStreamUsd}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Fee</span>
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>
                          {feeAmount > 0n ? `${formatUnits(feeAmount, underlyingDecimals)} ${underlyingLabel}` : `0 ${underlyingLabel}`}
                        </span>
                        {feeUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-fee">
                            {feeUsd}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Min received</span>
                      <span className="nb-preview-value">
                        {minToUser > 0n ? `${formatUnits(minToUser, underlyingDecimals)} ${underlyingLabel}` : "--"}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Stream ends</span>
                      <span className="text-base font-bold text-black">
                        {formatDate(resolvedExpiry)}
                      </span>
                    </div>
                  </div>

                  {/* Unlimited approval opt-in */}
                  <label className="flex items-center gap-3 text-sm text-black">
                    <input
                      type="checkbox"
                      checked={unlimitedApproval}
                      onChange={(event) => setUnlimitedApproval(event.target.checked)}
                      className="h-4 w-4 accent-[#5dc0f5]"
                      data-testid="checkbox-unlimited-approval"
                    />
                    <span className="nb-kicker text-black/60">Unlimited approvals</span>
                  </label>

                  {/* Warnings */}
                  {maturingSoon ? <div className="nb-status nb-status-warning text-xs">Market matures soon (&lt; 24h).</div> : null}
                  {selectedMarketExpired ? <div className="nb-status nb-status-error text-xs">Market expired.</div> : null}
                  {insufficientPtBalance ? <div className="nb-status nb-status-error text-xs">Insufficient PT balance.</div> : null}
                  {insufficientUnderlyingBalance ? <div className="nb-status nb-status-error text-xs">Insufficient {underlyingLabel} balance.</div> : null}
                  {belowMinPt ? <div className="nb-status nb-status-error text-xs">Amount is below the minimum deposit (1e6 base units).</div> : null}
                  {exceedsDepositLimit ? <div className="nb-status nb-status-error text-xs">Deposit would exceed this market&apos;s deposit limit.</div> : null}
                  {nothingToStream ? <div className="nb-status nb-status-error text-xs">Nothing to stream at the current rate. Try a different market or wait for the rate to move.</div> : null}
                  {ptAmount > 0n && !selectedMarketExpired && previewDeposit === undefined ? (
                    <div className="nb-status nb-status-warning text-xs">Waiting for on-chain preview...</div>
                  ) : null}

                  {/* Action buttons */}
                  {!address ? (
                    <>
                      <div className="nb-status nb-status-info text-sm">Connect wallet to continue.</div>
                      <WalletActionCta />
                    </>
                  ) : wrongChain ? (
                    <>
                      <div className="nb-status nb-status-error text-sm">Switch to chain {CHAIN_ID}.</div>
                      <WalletActionCta />
                    </>
                  ) : txPhase === "success" ? (
                    <div className="nb-status nb-status-success text-center text-sm font-bold">OVRFLO Created.</div>
                  ) : (
                    <>
                      {(txPhase === "waiting-pt-approval" || txPhase === "waiting-underlying-approval" || txPhase === "waiting-deposit") ? (
                        <div className="nb-status nb-status-warning text-center text-sm">Confirming...</div>
                      ) : null}

                      {needsPtApproval ? (
                        <button
                          type="button"
                          onClick={handleApprovePt}
                          disabled={!canProceed || isBusy}
                          className="nb-button w-full"
                          data-testid="button-approve-pt"
                        >
                          {txPhase === "approving-pt" ? "Submitting..." : txPhase === "waiting-pt-approval" ? "Confirming..." : "Approve PT"}
                        </button>
                      ) : needsUnderlyingApproval ? (
                        <button
                          type="button"
                          onClick={handleApproveUnderlying}
                          disabled={!canProceed || isBusy}
                          className="nb-button w-full"
                          data-testid="button-approve-underlying"
                        >
                          {txPhase === "approving-underlying" ? "Submitting..." : txPhase === "waiting-underlying-approval" ? "Confirming..." : `Approve ${underlyingLabel}`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleDeposit}
                          disabled={!canProceed || isBusy}
                          className="nb-button nb-button-dark w-full"
                          data-testid="button-create-ovrflo"
                        >
                          {txPhase === "creating" ? "Submitting..." : txPhase === "waiting-deposit" ? "Confirming..." : "Create OVRFLO"}
                        </button>
                      )}
                    </>
                  )}

                  {/* Error */}
                  {txPhase === "error" ? (
                    <div className="nb-status nb-status-error break-all text-xs">
                      {errorMsg}
                      <button
                        type="button"
                        onClick={() => { setTxPhase("idle"); setTxHash(undefined); setErrorMsg(""); }}
                        className="nb-link ml-2 inline-block text-[#b13a57]"
                        data-testid="button-retry-create"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </>
              ) : marketsForOvrflo.length === 0 ? (
                <div className="nb-status nb-status-info text-sm">No active maturities for this underlying.</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
