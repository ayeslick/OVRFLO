"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/constants";
import { erc20Abi, ovrfloAbi } from "@/lib/contracts";
import { getDecimals, useTokenDecimals } from "@/hooks/useTokenMeta";
import { getTokenSymbol, useTokenSymbols } from "@/hooks/useTokenLabels";
import { parseUserError } from "@/lib/tx-errors";
import { WalletActionCta } from "./WalletActionCta";
import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MockClaimFlowData } from "@/lib/mock-dashboard";

interface ClaimPreviewProps {
  tokenLabels: Record<`0x${string}`, string>;
  marketLabels: Record<`0x${string}`, string>;
  claimFlows: Record<`0x${string}`, MockClaimFlowData>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  preview?: ClaimPreviewProps;
}

interface MatureMarket extends MarketInfo {
  ovrfloEntry: OvrfloEntry;
}

type TxPhase = "idle" | "claiming" | "waiting" | "success" | "error";

function lookupLabel(
  labels: Record<`0x${string}`, string> | undefined,
  address: `0x${string}` | undefined,
  fallback: string,
) {
  return address ? labels?.[address] ?? fallback : fallback;
}

function formatAddress(address?: `0x${string}`) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Token";
}

function sanitizeAmount(value: string) {
  return value.replace(/[^0-9.]/g, "");
}

function parsePreviewAmount(value: string, decimals: number) {
  try {
    return parseUnits(value.replace(/,/g, ""), decimals);
  } catch {
    return 0n;
  }
}

export function ClaimModal({ open, onClose, ovrflos, allMarkets, preview }: Props) {
  const previewMode = Boolean(preview);
  const { address, chainId } = useAccount();
  const [selected, setSelected] = useState<MatureMarket>();
  const [amountStr, setAmountStr] = useState("");
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();

  const { isSuccess: receiptConfirmed, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  const now = BigInt(Math.floor(Date.now() / 1000));
  const matureMarkets = useMemo(
    () =>
      allMarkets
        .filter((market) => market.expiry <= now)
        .map((market) => {
          const ovrfloEntry = ovrflos.find((ovrflo) => ovrflo.address.toLowerCase() === market.ovrflo.toLowerCase());
          return ovrfloEntry ? { ...market, ovrfloEntry } : undefined;
        })
        .filter((market): market is MatureMarket => Boolean(market)),
    [allMarkets, now, ovrflos],
  );

  const symbolMap = useTokenSymbols(previewMode ? [] : [...allMarkets.map((market) => market.ptToken), ...ovrflos.map((ovrflo) => ovrflo.ovrfloToken)]);
  const decMap = useTokenDecimals(previewMode ? [] : [selected?.ovrfloToken, selected?.ptToken]);
  const ovrfloDecimals = getDecimals(decMap, selected?.ovrfloToken);
  const ptDecimals = getDecimals(decMap, selected?.ptToken);

  useEffect(() => {
    if (!open) return;
    setSelected(matureMarkets[0]);
    setAmountStr("");
    setTxPhase("idle");
    setTxHash(undefined);
    setErrorMsg("");
  }, [matureMarkets, open]);

  useEffect(() => {
    if (!txHash) return;
    if (receiptConfirmed && txPhase === "waiting") {
      setTxPhase("success");
      setTxHash(undefined);
    }
    if (receiptFailed) {
      setTxPhase("error");
      setErrorMsg("Transaction failed on-chain.");
      setTxHash(undefined);
    }
  }, [receiptConfirmed, receiptFailed, txHash, txPhase]);

  const { data: ovrfloBalance } = useReadContract({
    address: selected?.ovrfloToken as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !previewMode && !!address && !!selected },
  });

  const { data: claimablePt } = useReadContract({
    address: selected?.ovrflo as Address,
    abi: ovrfloAbi,
    functionName: "claimablePt",
    args: selected ? [selected.ptToken as Address] : undefined,
    query: { enabled: !previewMode && !!selected },
  });

  const previewFlow = selected ? preview?.claimFlows[selected.market] : undefined;
  const wrongChain = !previewMode && !!address && chainId !== CHAIN_ID;
  const claimAmount =
    amountStr && selected
      ? (() => {
          try { return parseUnits(amountStr, ovrfloDecimals); } catch { return 0n; }
        })()
      : 0n;
  const isBusy = txPhase === "claiming" || txPhase === "waiting";
  const previewMaxClaimable = previewFlow ? parsePreviewAmount(previewFlow.maxAmount, ovrfloDecimals) : undefined;
  const liveMaxClaimable =
    ovrfloBalance !== undefined && claimablePt !== undefined
      ? ovrfloBalance < claimablePt ? ovrfloBalance : claimablePt
      : undefined;
  const maxClaimable = previewMode ? previewMaxClaimable : liveMaxClaimable;
  const claimTooHigh = maxClaimable !== undefined && claimAmount > 0n && claimAmount > maxClaimable;
  const ptSymbol = lookupLabel(
    preview?.tokenLabels,
    selected?.ptToken,
    getTokenSymbol(symbolMap, selected?.ptToken, formatAddress(selected?.ptToken)),
  );
  const marketLabel = selected
    ? lookupLabel(preview?.marketLabels, selected.market, `${ptSymbol} ${new Date(Number(selected.expiry) * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`)
    : "";
  const receiveLabel = previewMode
    ? amountStr.trim() ? `${amountStr} ${marketLabel}` : previewFlow?.receiveAmount ?? "--"
    : claimAmount > 0n ? `${formatUnits(claimAmount, ptDecimals)} ${marketLabel}` : "--";

  const handleClaim = useCallback(async () => {
    if (!selected || claimAmount === 0n || claimTooHigh) return;
    setErrorMsg("");
    if (previewMode) { setTxPhase("success"); return; }
    setTxPhase("claiming");
    try {
      const hash = await writeContractAsync({
        address: selected.ovrflo as Address,
        abi: ovrfloAbi,
        functionName: "claim",
        args: [selected.ptToken as Address, claimAmount],
      });
      setTxHash(hash);
      setTxPhase("waiting");
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Claim failed"));
    }
  }, [claimAmount, claimTooHigh, previewMode, selected, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="nb-modal-overlay" data-testid="modal-claim">
      <div className="nb-modal">
        {/* Header */}
        <div className="nb-modal-header">
          <h3 className="text-lg font-bold uppercase tracking-wide text-black">Claim</h3>
          <button
            type="button"
            onClick={onClose}
            className="nb-icon-button h-9 w-9 text-sm"
            aria-label="Close claim modal"
            data-testid="button-close-claim"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="nb-modal-body">
          {matureMarkets.length === 0 ? (
            <div className="nb-status nb-status-info py-4 text-sm">No mature markets available.</div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Market select */}
              <div>
                <label htmlFor="claim-market" className="nb-kicker mb-2 block text-black/40">
                  Select Mature Market
                </label>
                <select
                  id="claim-market"
                  value={selected?.market ?? ""}
                  onChange={(event) => {
                    const next = matureMarkets.find((market) => market.market === event.target.value);
                    setSelected(next);
                    setAmountStr("");
                    setTxPhase("idle");
                    setTxHash(undefined);
                    setErrorMsg("");
                  }}
                  className="nb-input nb-select w-full"
                  data-testid="select-mature-market"
                >
                  {matureMarkets.map((market) => (
                    <option key={market.market} value={market.market}>
                      {lookupLabel(
                        preview?.marketLabels,
                        market.market,
                        `${getTokenSymbol(symbolMap, market.ptToken, formatAddress(market.ptToken))} ${new Date(Number(market.expiry) * 1000).toLocaleDateString()}`,
                      )}
                    </option>
                  ))}
                </select>
              </div>

              {selected ? (
                <>
                  {/* Balance info */}
                  <div className="nb-preview-box">
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">OVRFLO Balance</span>
                      <span className="nb-preview-value">
                        {previewFlow?.ovrfloBalance ?? (ovrfloBalance !== undefined ? formatUnits(ovrfloBalance, ovrfloDecimals) : "--")}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">PT reserves</span>
                      <span className="nb-preview-value">
                        {previewFlow?.ptReserves ?? (claimablePt !== undefined ? formatUnits(claimablePt, ptDecimals) : "--")}
                      </span>
                    </div>
                  </div>

                  {/* Amount to claim */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="claim-amount" className="nb-kicker text-black/40">
                        Amount to claim
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (previewFlow) {
                            setAmountStr(previewFlow.maxAmount);
                          } else if (maxClaimable !== undefined) {
                            setAmountStr(formatUnits(maxClaimable, ovrfloDecimals));
                          }
                        }}
                        className="nb-button px-3 py-1.5 text-[10px]"
                        style={{ minHeight: "32px" }}
                        data-testid="button-max-claim"
                      >
                        MAX
                      </button>
                    </div>
                    <input
                      id="claim-amount"
                      type="text"
                      inputMode="decimal"
                      value={amountStr}
                      onChange={(event) => {
                        setAmountStr(sanitizeAmount(event.target.value));
                        setErrorMsg("");
                      }}
                      placeholder="0.0"
                      className="nb-input mono w-full"
                      data-testid="input-claim-amount"
                    />
                  </div>

                  {/* You receive */}
                  <div className="nb-preview-box">
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">You receive</span>
                      <span className="nb-preview-value">{receiveLabel}</span>
                    </div>
                  </div>

                  {claimTooHigh ? <div className="nb-status nb-status-error text-xs">Amount exceeds available balance.</div> : null}

                  {/* Actions */}
                  {!previewMode && !address ? (
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
                    <div className="nb-status nb-status-success text-center text-sm font-bold">Claimed.</div>
                  ) : (
                    <>
                      {txPhase === "waiting" ? <div className="nb-status nb-status-warning text-center text-sm">Confirming...</div> : null}
                      <button
                        type="button"
                        onClick={handleClaim}
                        disabled={isBusy || claimAmount === 0n || claimTooHigh}
                        className="nb-button nb-button-dark w-full"
                        data-testid="button-claim-submit"
                      >
                        {txPhase === "claiming" ? "Submitting..." : txPhase === "waiting" ? "Confirming..." : "Claim"}
                      </button>
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
                        data-testid="button-retry-claim"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
