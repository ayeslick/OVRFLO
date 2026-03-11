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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,18,33,0.8)] p-4">
      <div className="nb-panel relative w-full max-w-xl p-6 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="nb-kicker text-[var(--color-border)]">Create sleeve</p>
            <h3 className="mt-2 text-xl text-[var(--color-ink)]">New OVRFLO</h3>
          </div>
          <div className="flex items-center gap-3">
            <SlippageSettings slippageBps={slippageBps} onChange={setSlippageBps} />
            <button
              onClick={onClose}
              className="nb-icon-button"
              aria-label="Close new OVRFLO modal"
            >
              ✕
            </button>
          </div>
        </div>

        {step === "underlying" && (
          <div className="flex flex-col gap-3">
            <label className="nb-kicker text-[var(--color-border)]">Select underlying</label>
            {ovrflos.map((ovrflo) => {
              const symbol = getTokenSymbol(symbolMap, ovrflo.underlying, formatAddress(ovrflo.underlying));
              return (
                <button
                  key={ovrflo.address}
                  onClick={() => {
                    setSelectedOvrflo(ovrflo);
                    setStep("maturity");
                  }}
                  className="nb-select-card"
                >
                  <div className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{symbol}</div>
                  <div className="mt-2 text-xs text-[var(--color-ink)]/70">{formatAddress(ovrflo.underlying)}</div>
                </button>
              );
            })}
          </div>
        )}

        {step === "maturity" && selectedOvrflo && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setStep("underlying");
                setSelectedOvrflo(undefined);
              }}
              className="nb-link w-fit text-[var(--color-border)]"
            >
              ← Back
            </button>
            <label className="nb-kicker text-[var(--color-border)]">Select maturity</label>
            {marketsForOvrflo.length === 0 && (
              <div className="nb-status nb-status-info text-sm leading-6">No active markets.</div>
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
                  className="nb-select-card"
                >
                  <div className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{symbol}</div>
                  <div className="mt-2 text-xs text-[var(--color-ink)]/70">
                    Expires: {new Date(Number(market.expiry) * 1000).toLocaleDateString()} · {formatAddress(market.market)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {step === "amount" && selectedOvrflo && selectedMarket && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => {
                setStep("maturity");
                setSelectedMarket(undefined);
                setAmountStr("");
                setErrorMsg("");
              }}
              className="nb-link w-fit text-[var(--color-border)]"
            >
              ← Back
            </button>

            <div className="grid gap-3 rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm shadow-[var(--shadow-hard-sm)]">
              <div className="flex justify-between gap-4">
                <span className="nb-kicker text-[var(--color-border)]">Underlying</span>
                <span className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{getTokenSymbol(symbolMap, selectedOvrflo.underlying, formatAddress(selectedOvrflo.underlying))}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="nb-kicker text-[var(--color-border)]">Maturity</span>
                <span className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{new Date(Number(selectedMarket.expiry) * 1000).toLocaleDateString()}</span>
              </div>
            </div>

            <label htmlFor="new-ovrflo-amount" className="nb-kicker text-[var(--color-border)]">Amount ({ptSymbol})</label>
            <div className="flex items-center gap-2">
              <input
                id="new-ovrflo-amount"
                type="text"
                value={amountStr}
                onChange={(event) => {
                  setAmountStr(event.target.value);
                  setErrorMsg("");
                }}
                placeholder="0.0"
                className="nb-input mono flex-1"
              />
              {ptBalance !== undefined && (
                <span className="text-xs text-[var(--color-ink)]/70">Bal: {formatUnits(ptBalance, ptDecimals)}</span>
              )}
            </div>
            {inputUsd && <p className="text-xs text-[var(--color-ink)]/70">≈ {inputUsd}</p>}

            {preview && ptAmount > 0n && !selectedMarketExpired && (
              <div className="grid gap-2 rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm shadow-[var(--shadow-hard-sm)]">
                <div className="flex justify-between gap-4">
                  <span className="nb-kicker text-[var(--color-border)]">Immediate</span>
                  <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                    {formatUnits(toUser, ptDecimals)}{immediateUsd ? ` (${immediateUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="nb-kicker text-[var(--color-border)]">Streamed</span>
                  <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                    {formatUnits(toStream, ptDecimals)}{streamedUsd ? ` (${streamedUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="nb-kicker text-[var(--color-border)]">Fee ({underlyingSymbol})</span>
                  <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                    {formatUnits(feeAmount, underlyingDecimals)}{feeUsd ? ` (${feeUsd})` : ""}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="nb-kicker text-[var(--color-border)]">Min received ({slippageBps / 100}%)</span>
                  <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{formatUnits(minToUser, ptDecimals)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="nb-kicker text-[var(--color-border)]">Stream ends</span>
                  <span className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">{new Date(Number(selectedMarket.expiry) * 1000).toLocaleDateString()}</span>
                </div>
                {selectedMarket.expiry - now < 86400n && (
                  <div className="nb-status nb-status-warning text-xs">Market matures soon (&lt; 24h)</div>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-col gap-3">
              {!address ? (
                <>
                  <div className="nb-status nb-status-info text-sm">Connect your wallet to continue.</div>
                  <WalletActionCta />
                </>
              ) : wrongChain ? (
                <>
                  <div className="nb-status nb-status-error text-sm">Switch to chain {CHAIN_ID} to continue.</div>
                  <WalletActionCta />
                </>
              ) : selectedMarketExpired ? (
                <div className="nb-status nb-status-error text-sm">This market expired while the modal was open.</div>
              ) : txPhase === "success" ? (
                <div className="nb-status nb-status-success text-center text-sm">Deposit confirmed! Stream will appear shortly.</div>
              ) : (
                <>
                  {(txPhase === "waiting-pt-approval" ||
                    txPhase === "waiting-underlying-approval" ||
                    txPhase === "waiting-deposit") && (
                    <div className="nb-status nb-status-warning text-center text-sm">Waiting for on-chain confirmation...</div>
                  )}

                  {insufficientPtBalance && (
                    <div className="nb-status nb-status-error text-xs">Insufficient {ptSymbol} balance for this deposit.</div>
                  )}
                  {insufficientUnderlyingBalance && feeAmount > 0n && (
                    <div className="nb-status nb-status-error text-xs">Insufficient {underlyingSymbol} balance to pay the deposit fee.</div>
                  )}

                  {needsPtApproval ? (
                    <button
                      onClick={handleApprovePt}
                      disabled={!canProceed || isBusy}
                      className="nb-button w-full"
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
                      className="nb-button w-full"
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
                      className="nb-button w-full"
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
                <div className="nb-status nb-status-error break-all text-xs">
                  {errorMsg}
                  <button
                    onClick={() => {
                      setTxPhase("idle");
                      setTxHash(undefined);
                      setErrorMsg("");
                    }}
                    className="nb-link ml-2 inline-block text-[#8e2340]"
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
