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
import { WalletActionCta } from "./WalletActionCta";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
}

interface MatureMarket extends MarketInfo {
  ovrfloEntry: OvrfloEntry;
}

type TxPhase = "idle" | "claiming" | "waiting" | "success" | "error";

export function ClaimModal({ open, onClose, ovrflos, allMarkets }: Props) {
  const { address, chainId } = useAccount();
  const [selected, setSelected] = useState<MatureMarket>();
  const [amountStr, setAmountStr] = useState("");
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
    selected?.ovrfloToken,
    selected?.ptToken,
  ]);
  const symbolMap = useTokenSymbols([
    ...allMarkets.map((market) => market.ptToken),
    ...ovrflos.map((ovrflo) => ovrflo.ovrfloToken),
  ]);
  const { data: usdPrices } = useUsdPrices([
    selected?.ovrfloToken,
    selected?.ptToken,
  ]);
  const ovrfloDecimals = getDecimals(decMap, selected?.ovrfloToken);
  const ptDecimals = getDecimals(decMap, selected?.ptToken);

  useEffect(() => {
    if (open) {
      setSelected(undefined);
      setAmountStr("");
      setTxPhase("idle");
      setTxHash(undefined);
      setErrorMsg("");
    }
  }, [open]);

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
  }, [receiptConfirmed, receiptFailed, txPhase, txHash]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const matureMarkets: MatureMarket[] = allMarkets
    .filter((m) => m.expiry <= now)
    .map((m) => {
      const ovrfloEntry = ovrflos.find(
        (o) => o.address.toLowerCase() === m.ovrflo.toLowerCase()
      )!;
      return { ...m, ovrfloEntry };
    })
    .filter((m) => m.ovrfloEntry);

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

  const wrongChain = chainId !== CHAIN_ID;
  const claimAmount = amountStr
    ? (() => {
        try {
          return parseUnits(amountStr, ovrfloDecimals);
        } catch {
          return 0n;
        }
      })()
    : 0n;
  const isBusy = txPhase === "claiming" || txPhase === "waiting";

  // WEB-009 fix: MAX caps to min(wallet balance, claimable PT)
  const maxClaimable =
    ovrfloBalance !== undefined && claimablePt !== undefined
      ? ovrfloBalance < claimablePt
        ? ovrfloBalance
        : claimablePt
      : undefined;
  const claimTooHigh =
    maxClaimable !== undefined && claimAmount > 0n && claimAmount > maxClaimable;
  const ptSymbol = getTokenSymbol(symbolMap, selected?.ptToken, undefined);
  const ovrfloUsd = getTokenUsd(usdPrices?.tokenUsd, selected?.ovrfloToken);
  const ptUsd = getTokenUsd(usdPrices?.tokenUsd, selected?.ptToken);

  const handleClaim = useCallback(async () => {
    if (!selected || claimAmount === 0n || claimTooHigh) return;
    setTxPhase("claiming");
    setErrorMsg("");
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
  }, [selected, claimAmount, claimTooHigh, writeContractAsync]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,18,33,0.8)] p-4">
      <div className="nb-panel relative w-full max-w-xl p-6 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="nb-kicker text-[var(--color-border)]">Claim matured PT</p>
            <h3 className="mt-2 text-xl text-[var(--color-ink)]">Claim</h3>
          </div>
          <button
            onClick={onClose}
            className="nb-icon-button"
            aria-label="Close claim modal"
          >
            ✕
          </button>
        </div>

        <label className="nb-kicker mb-2 block text-[var(--color-border)]">
          Select mature market
        </label>

        {matureMarkets.length === 0 && (
          <div className="nb-status nb-status-info py-4 text-sm">No mature markets available.</div>
        )}

        {!selected && matureMarkets.length > 0 && (
          <div className="flex flex-col gap-3">
            {matureMarkets.map((m) => (
              <button
                key={`${m.ovrflo}-${m.market}`}
                onClick={() => setSelected(m)}
                className="nb-select-card"
              >
                <div className="font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                  {getTokenSymbol(symbolMap, m.ptToken, `${m.ptToken.slice(0, 6)}...${m.ptToken.slice(-4)}`)}
                </div>
                <div className="mt-2 text-xs text-[var(--color-ink)]/70">
                  Matured: {new Date(Number(m.expiry) * 1000).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => {
                setSelected(undefined);
                setAmountStr("");
              }}
              className="nb-link w-fit text-[var(--color-border)]"
            >
              ← Back
            </button>

            <div className="grid gap-3 rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm shadow-[var(--shadow-hard-sm)]">
              <div className="flex justify-between gap-4">
                <span className="nb-kicker text-[var(--color-border)]">OVRFLO balance</span>
                <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                  {ovrfloBalance !== undefined
                    ? `${formatUnits(ovrfloBalance, ovrfloDecimals)}${ovrfloUsd !== undefined ? ` (${formatUsdValue(ovrfloBalance, ovrfloDecimals, ovrfloUsd)})` : ""}`
                    : "..."}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="nb-kicker text-[var(--color-border)]">PT reserves</span>
                <span className="mono font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
                  {claimablePt !== undefined
                    ? `${formatUnits(claimablePt, ptDecimals)}${ptUsd !== undefined ? ` (${formatUsdValue(claimablePt, ptDecimals, ptUsd)})` : ""}`
                    : "..."}
                </span>
              </div>
            </div>

            <label htmlFor="claim-amount" className="nb-kicker text-[var(--color-border)]">
              Amount to claim ({ptSymbol})
            </label>
            <div className="flex items-center gap-2">
              <input
                id="claim-amount"
                type="text"
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setErrorMsg("");
                }}
                placeholder="0.0"
                className="nb-input mono flex-1"
              />
              <button
                onClick={() => {
                  if (maxClaimable !== undefined)
                    setAmountStr(formatUnits(maxClaimable, ovrfloDecimals));
                }}
                className="nb-button nb-button-secondary min-h-11 px-3 py-2 text-[0.6875rem]"
              >
                MAX
              </button>
            </div>

            {claimTooHigh && (
              <div className="nb-status nb-status-error text-xs">
                Amount exceeds claimable maximum of{" "}
                {maxClaimable !== undefined
                  ? formatUnits(maxClaimable, ovrfloDecimals)
                  : "0"}.
              </div>
            )}

            {txPhase === "waiting" && (
              <div className="nb-status nb-status-warning text-center text-sm">
                Waiting for on-chain confirmation...
              </div>
            )}

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
            ) : txPhase === "success" ? (
              <div className="nb-status nb-status-success text-center text-sm">Claim confirmed!</div>
            ) : (
              <button
                onClick={handleClaim}
                disabled={isBusy || claimAmount === 0n || claimTooHigh}
                className="nb-button w-full"
              >
                {txPhase === "claiming"
                  ? "Submitting..."
                  : txPhase === "waiting"
                    ? "Confirming..."
                    : "Claim"}
              </button>
            )}
            {txPhase === "error" && (
              <div className="nb-status nb-status-error break-all text-xs">
                {errorMsg}
                <button
                  onClick={() => {
                    setTxPhase("idle");
                    setTxHash(undefined);
                  }}
                  className="nb-link ml-2 inline-block text-[#8e2340]"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
