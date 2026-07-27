import { parseEventLogs, type Address, type Log } from "viem";
import { eligibilityErrorNames, STALE_LIQUIDITY_REASONS } from "./errors";
import { ovrfloLendingAbi } from "./generated";
import { BPS } from "./lending-math";
import type { TickDepth } from "./router";

// Pure logic for the BORROW form (ticket 06). Selection and fill planning are
// price-blind like lib/router.ts — the form clamps the fill to the on-chain
// grossPrice from quote() before submitting.

export const SLIPPAGE_MIN_BPS = 10n;
export const SLIPPAGE_MAX_BPS = 500n;
export const SLIPPAGE_DEFAULT_PCT = "0.5";

// Keeps the user's tick while it still has borrowable (non-self) depth,
// otherwise falls back to the lowest liquid tick — the ladder's "best" default.
export function resolveSelectedTick(ladder: TickDepth[], selectedAprBps: number | null): number | null {
  const liquid = ladder.filter((t) => t.total > 0n).sort((a, b) => a.aprBps - b.aprBps);
  if (selectedAprBps !== null && liquid.some((t) => t.aprBps === selectedAprBps)) return selectedAprBps;
  return liquid[0]?.aprBps ?? null;
}

export type SelectedBorrowPlan = {
  fill: bigint;
  partial: boolean;
  // Lowest tick that fully covers the target — offered only behind an explicit
  // "show other options" click, and only when the selected tick cannot cover.
  alternativeAprBps: number | null;
};

export function planSelectedBorrow(
  ladder: TickDepth[],
  selectedAprBps: number,
  target: bigint,
): SelectedBorrowPlan {
  const selected = ladder.find((t) => t.aprBps === selectedAprBps);
  const depth = selected?.total ?? 0n;
  const fill = target < depth ? target : depth;
  if (fill >= target) return { fill, partial: false, alternativeAprBps: null };

  const covering = [...ladder]
    .filter((t) => t.aprBps !== selectedAprBps && t.total >= target && t.total > 0n)
    .sort((a, b) => a.aprBps - b.aprBps)[0];
  return { fill, partial: true, alternativeAprBps: covering?.aprBps ?? null };
}

// Percent string -> bps, up to two decimals, bounded to [SLIPPAGE_MIN_BPS, SLIPPAGE_MAX_BPS].
export function parseSlippageBps(raw: string): bigint | null {
  const match = raw.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const bps = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps < SLIPPAGE_MIN_BPS || bps > SLIPPAGE_MAX_BPS) return null;
  return bps;
}

export type BorrowErrorKind = "stale" | "terminal" | "retryable";

export function classifyBorrowError(error: unknown): BorrowErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (STALE_LIQUIDITY_REASONS.some((reason) => message.includes(reason))) return "stale";
  if (message.includes("OVRFLOLending:")) return "terminal";
  if (eligibilityErrorNames.some((name) => message.includes(name))) return "terminal";
  return "retryable";
}

// The receipt is the source of truth for what the borrower actually received:
// a partial fill can succeed without reverting when liquidity shrinks between
// gather and execution. `net` mirrors StreamPricing.fee's floor division.
export function borrowReceiptSummary(
  logs: Log[],
  feeBps: number,
  lending: Address,
): { loanId: bigint; contributed: bigint; net: bigint } | null {
  const lendingKey = lending.toLowerCase();
  const [created] = parseEventLogs({
    abi: ovrfloLendingAbi,
    eventName: "BorrowerLoanPoolCreated",
    logs: logs.filter((log) => log.address.toLowerCase() === lendingKey),
  });
  if (!created) return null;
  const contributed = created.args.totalContributed;
  const fee = (contributed * BigInt(feeBps)) / BPS;
  return { loanId: created.args.loanId, contributed, net: contributed - fee };
}
