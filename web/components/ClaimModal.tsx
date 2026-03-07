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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--color-heading)]">
            Claim
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-heading)]"
            aria-label="Close claim modal"
          >
            ✕
          </button>
        </div>

        <label className="text-sm text-[var(--color-muted)] mb-2 block">
          Select Mature Market
        </label>

        {matureMarkets.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] py-4">
            No mature markets available.
          </p>
        )}

        {!selected && matureMarkets.length > 0 && (
          <div className="flex flex-col gap-2">
            {matureMarkets.map((m) => (
              <button
                key={`${m.ovrflo}-${m.market}`}
                onClick={() => setSelected(m)}
                className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
              >
                <div className="text-[var(--color-heading)] font-semibold">
                  {getTokenSymbol(symbolMap, m.ptToken, `${m.ptToken.slice(0, 6)}...${m.ptToken.slice(-4)}`)}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  Matured: {new Date(Number(m.expiry) * 1000).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setSelected(undefined);
                setAmountStr("");
              }}
              className="text-sm text-[var(--color-accent)]"
            >
              ← Back
            </button>

            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">
                  OVRFLO Balance
                </span>
                <span className="mono text-[var(--color-heading)]">
                  {ovrfloBalance !== undefined
                    ? `${formatUnits(ovrfloBalance, ovrfloDecimals)}${ovrfloUsd !== undefined ? ` (${formatUsdValue(ovrfloBalance, ovrfloDecimals, ovrfloUsd)})` : ""}`
                    : "..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">PT reserves</span>
                <span className="mono text-[var(--color-heading)]">
                  {claimablePt !== undefined
                    ? `${formatUnits(claimablePt, ptDecimals)}${ptUsd !== undefined ? ` (${formatUsdValue(claimablePt, ptDecimals, ptUsd)})` : ""}`
                    : "..."}
                </span>
              </div>
            </div>

            <label className="text-sm text-[var(--color-muted)]">
              Amount to claim ({ptSymbol})
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setErrorMsg("");
                }}
                placeholder="0.0"
                className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-heading)] mono"
              />
              <button
                onClick={() => {
                  if (maxClaimable !== undefined)
                    setAmountStr(formatUnits(maxClaimable, ovrfloDecimals));
                }}
                className="text-xs px-2 py-1 bg-[var(--color-border)] text-[var(--color-heading)] rounded"
              >
                MAX
              </button>
            </div>

            {claimTooHigh && (
              <p className="text-red-400 text-xs">
                Amount exceeds claimable maximum of{" "}
                {maxClaimable !== undefined
                  ? formatUnits(maxClaimable, ovrfloDecimals)
                  : "0"}.
              </p>
            )}

            {txPhase === "waiting" && (
              <p className="text-yellow-400 text-sm text-center py-1">
                Waiting for on-chain confirmation...
              </p>
            )}

            {!address ? (
              <>
                <p className="text-sm text-[var(--color-muted)]">
                  Connect your wallet to continue.
                </p>
                <WalletActionCta />
              </>
            ) : wrongChain ? (
              <>
                <p className="text-red-400 text-sm">
                  Switch to chain {CHAIN_ID} to continue.
                </p>
                <WalletActionCta />
              </>
            ) : txPhase === "success" ? (
              <p className="text-green-400 text-sm text-center py-2">
                Claim confirmed!
              </p>
            ) : (
              <button
                onClick={handleClaim}
                disabled={isBusy || claimAmount === 0n || claimTooHigh}
                className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
              >
                {txPhase === "claiming"
                  ? "Submitting..."
                  : txPhase === "waiting"
                    ? "Confirming..."
                    : "Claim"}
              </button>
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
        )}
      </div>
    </div>
  );
}
