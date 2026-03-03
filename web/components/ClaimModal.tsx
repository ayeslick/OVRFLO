"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { CHAIN_ID } from "@/lib/constants";
import { ovrfloAbi, erc20Abi } from "@/lib/contracts";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useApprovedMarkets";

interface Props {
  open: boolean;
  onClose: () => void;
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
}

interface MatureMarket extends MarketInfo {
  ovrfloEntry: OvrfloEntry;
}

export function ClaimModal({ open, onClose, ovrflos, allMarkets }: Props) {
  const { address, chainId } = useAccount();
  const [selected, setSelected] = useState<MatureMarket>();
  const [amountStr, setAmountStr] = useState("");
  const [txState, setTxState] = useState<"idle" | "claiming" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    if (open) {
      setSelected(undefined);
      setAmountStr("");
      setTxState("idle");
      setErrorMsg("");
    }
  }, [open]);

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
    ? (() => { try { return parseUnits(amountStr, 18); } catch { return 0n; } })()
    : 0n;

  async function handleClaim() {
    if (!selected || claimAmount === 0n) return;
    setTxState("claiming");
    setErrorMsg("");
    try {
      await writeContractAsync({
        address: selected.ovrflo as Address,
        abi: ovrfloAbi,
        functionName: "claim",
        args: [selected.ptToken as Address, claimAmount],
      });
      setTxState("success");
    } catch (e: unknown) {
      setTxState("error");
      setErrorMsg(e instanceof Error ? e.message.slice(0, 120) : "Claim failed");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-md p-6 relative">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--color-heading)]">Claim</h3>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-heading)]">
            ✕
          </button>
        </div>

        <label className="text-sm text-[var(--color-muted)] mb-2 block">
          Select Mature Market
        </label>

        {matureMarkets.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] py-4">No mature markets available.</p>
        )}

        {!selected && matureMarkets.length > 0 && (
          <div className="flex flex-col gap-2">
            {matureMarkets.map((m) => (
              <button
                key={`${m.ovrflo}-${m.market}`}
                onClick={() => setSelected(m)}
                className="text-left px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
              >
                <span className="text-[var(--color-heading)]">
                  {m.ptToken.slice(0, 6)}...{m.ptToken.slice(-4)}
                </span>
                <span className="text-xs text-[var(--color-muted)] ml-2">
                  Expired: {new Date(Number(m.expiry) * 1000).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => { setSelected(undefined); setAmountStr(""); }}
              className="text-sm text-[var(--color-accent)]"
            >
              ← Back
            </button>

            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">OVRFLO Balance</span>
                <span className="mono text-[var(--color-heading)]">
                  {ovrfloBalance !== undefined ? formatUnits(ovrfloBalance, 18) : "..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">PT reserves</span>
                <span className="mono text-[var(--color-heading)]">
                  {claimablePt !== undefined ? formatUnits(claimablePt, 18) : "..."}
                </span>
              </div>
            </div>

            <label className="text-sm text-[var(--color-muted)]">Amount to claim</label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-heading)] mono"
              />
              <button
                onClick={() => {
                  if (ovrfloBalance !== undefined) setAmountStr(formatUnits(ovrfloBalance, 18));
                }}
                className="text-xs px-2 py-1 bg-[var(--color-border)] text-[var(--color-heading)] rounded"
              >
                MAX
              </button>
            </div>

            {txState === "success" ? (
              <p className="text-green-400 text-sm text-center py-2">Claim successful!</p>
            ) : (
              <button
                onClick={handleClaim}
                disabled={wrongChain || txState === "claiming" || claimAmount === 0n}
                className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"
              >
                {txState === "claiming" ? "Claiming..." : "Claim"}
              </button>
            )}

            {wrongChain && (
              <p className="text-red-400 text-sm">Switch to chain {CHAIN_ID} first.</p>
            )}
            {txState === "error" && (
              <div className="text-red-400 text-xs break-all">
                {errorMsg}
                <button onClick={() => setTxState("idle")} className="ml-2 underline">
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
