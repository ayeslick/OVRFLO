"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/config";
import { erc20Abi, ovrfloAbi } from "@/lib/contracts";
import { getDecimals, useTokenDecimals } from "@/hooks/useTokenMeta";
import { getTokenSymbol, useTokenSymbols } from "@/hooks/useTokenLabels";
import {
  formatUsdValue,
  getOvrfloUsdForMarket,
  getPtUsdForMarket,
  type UsdPrices,
} from "@/hooks/useUsdPrices";
import { parseUserError } from "@/lib/tx-errors";
import { preflight } from "@/lib/preflight";
import { truncateAddress } from "@/lib/format";
import { useModalA11y } from "@/hooks/useModalA11y";
import { ModalErrorBoundary } from "./ModalErrorBoundary";
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

interface MatureMarket extends MarketInfo {
  ovrfloEntry: OvrfloEntry;
}

type TxPhase = "idle" | "claiming" | "waiting" | "success" | "error";

function formatAddress(address?: `0x${string}`) {
  return address ? truncateAddress(address) : "Token";
}

function sanitizeAmount(value: string) {
  return value.replace(/[^0-9.]/g, "");
}

export function ClaimModal({ open, onClose, ovrflos, allMarkets, prices }: Props) {
  const dialogRef = useModalA11y({ open, onClose });
  const { address, chainId } = useAccount();
  const [selected, setSelected] = useState<MatureMarket>();
  const [amountStr, setAmountStr] = useState("");
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

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

  const symbolMap = useTokenSymbols([
    ...allMarkets.map((market) => market.ptToken),
    ...ovrflos.map((ovrflo) => ovrflo.ovrfloToken),
  ]);
  const decMap = useTokenDecimals([selected?.ovrfloToken, selected?.ptToken]);
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
    query: { enabled: !!address && !!selected },
  });

  const { data: claimablePt } = useReadContract({
    address: selected?.ovrflo as Address,
    abi: ovrfloAbi,
    functionName: "claimablePt",
    args: selected ? [selected.ptToken as Address] : undefined,
    query: { enabled: !!selected },
  });

  const wrongChain = !!address && chainId !== CHAIN_ID;
  const claimAmount =
    amountStr && selected
      ? (() => {
          try { return parseUnits(amountStr, ovrfloDecimals); } catch { return 0n; }
        })()
      : 0n;
  const isBusy = txPhase === "claiming" || txPhase === "waiting";
  const maxClaimable =
    ovrfloBalance !== undefined && claimablePt !== undefined
      ? ovrfloBalance < claimablePt ? ovrfloBalance : claimablePt
      : undefined;
  const claimTooHigh = maxClaimable !== undefined && claimAmount > 0n && claimAmount > maxClaimable;
  const ptSymbol = getTokenSymbol(symbolMap, selected?.ptToken, formatAddress(selected?.ptToken));
  const marketLabel = selected
    ? `${ptSymbol} ${new Date(Number(selected.expiry) * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`
    : "";
  const receiveLabel =
    claimAmount > 0n ? `${formatUnits(claimAmount, ptDecimals)} ${marketLabel}` : "--";

  const ptUsd = getPtUsdForMarket(prices, selected?.market);
  const ovrfloUsd = getOvrfloUsdForMarket(prices, selected?.market);
  const ovrfloBalanceUsd =
    ovrfloBalance !== undefined
      ? formatUsdValue(ovrfloBalance, ovrfloDecimals, ovrfloUsd)
      : undefined;
  const claimablePtUsd =
    claimablePt !== undefined
      ? formatUsdValue(claimablePt, ptDecimals, ptUsd)
      : undefined;
  const receiveUsd =
    claimAmount > 0n ? formatUsdValue(claimAmount, ptDecimals, ptUsd) : undefined;

  const handleClaim = useCallback(async () => {
    if (!selected || claimAmount === 0n || claimTooHigh) return;
    setErrorMsg("");
    if (!publicClient || !address) {
      setTxPhase("error");
      setErrorMsg("Wallet not connected.");
      return;
    }
    setTxPhase("claiming");
    // R15 preflight — guard against contract reverts (e.g. ovrflo: not
    // matured, ovrflo: deposit accounting) before the wallet prompts.
    const sim = await preflight(
      publicClient,
      {
        address: selected.ovrflo as Address,
        abi: ovrfloAbi,
        functionName: "claim",
        args: [selected.ptToken as Address, claimAmount],
        account: address,
      },
      "Claim failed"
    );
    if (!sim.ok) {
      setTxPhase("error");
      setErrorMsg(sim.error.message);
      return;
    }
    try {
      const hash = await writeContractAsync(sim.request);
      setTxHash(hash);
      setTxPhase("waiting");
    } catch (error: unknown) {
      setTxPhase("error");
      setErrorMsg(parseUserError(error, "Claim failed"));
    }
  }, [address, claimAmount, claimTooHigh, publicClient, selected, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="nb-modal-overlay" data-testid="modal-claim">
      <div
        ref={dialogRef}
        className="nb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
      >
        {/* Header */}
        <div className="nb-modal-header">
          <h3 id="claim-modal-title" className="text-lg font-bold uppercase tracking-wide text-black">Claim</h3>
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

        {/* Body — wrapped in ModalErrorBoundary (R14). See NewOvrfloModal
            for the rationale. */}
        <div className="nb-modal-body">
          <ModalErrorBoundary>
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
                      {`${getTokenSymbol(symbolMap, market.ptToken, formatAddress(market.ptToken))} ${new Date(Number(market.expiry) * 1000).toLocaleDateString()}`}
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
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>
                          {ovrfloBalance !== undefined ? formatUnits(ovrfloBalance, ovrfloDecimals) : "--"}
                        </span>
                        {ovrfloBalanceUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-ovrflo-balance">
                            {ovrfloBalanceUsd}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="nb-preview-row">
                      <span className="nb-preview-label">Claimable PT (contract)</span>
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>
                          {claimablePt !== undefined ? formatUnits(claimablePt, ptDecimals) : "--"}
                        </span>
                        {claimablePtUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-claimable-pt">
                            {claimablePtUsd}
                          </span>
                        ) : null}
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
                          if (maxClaimable !== undefined) {
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
                      <span className="nb-preview-value flex flex-col items-end">
                        <span>{receiveLabel}</span>
                        {receiveUsd ? (
                          <span className="mono text-[10px] font-normal text-black/40" data-testid="usd-receive">
                            {receiveUsd}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>

                  {claimTooHigh ? <div className="nb-status nb-status-error text-xs">Amount exceeds available balance.</div> : null}

                  {/* Actions */}
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
          </ModalErrorBoundary>
        </div>
      </div>
    </div>
  );
}
