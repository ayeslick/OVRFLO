import { parseEventLogs, type Address, type Log } from "viem";
import { eligibilityErrorNames, REBUILD_STALE_REASONS, STALE_LIQUIDITY_REASONS } from "./errors";
import { ovrfloLendingAbi } from "./generated";
import { BPS } from "./lending-math";

// Pure logic for the BORROW form (ticket 06). Price-blind like lib/router.ts —
// the form clamps the fill to the on-chain grossPrice from quote() before submitting.

export const SLIPPAGE_MIN_BPS = 10n;
export const SLIPPAGE_MAX_BPS = 500n;

// Percent string -> bps, up to two decimals, bounded to [SLIPPAGE_MIN_BPS, SLIPPAGE_MAX_BPS].
export function parseSlippageBps(raw: string): bigint | null {
  const match = raw.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = match[1];
  if (whole === undefined) return null;
  const bps = BigInt(whole) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps < SLIPPAGE_MIN_BPS || bps > SLIPPAGE_MAX_BPS) return null;
  return bps;
}

export type BorrowErrorKind = "stale" | "terminal" | "retryable";

export function classifyBorrowError(error: unknown): BorrowErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (STALE_LIQUIDITY_REASONS.some((reason) => message.includes(reason))) return "stale";
  if (REBUILD_STALE_REASONS.some((reason) => message.includes(reason))) return "stale";
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
    eventName: "Borrowed",
    logs: logs.filter((log) => log.address.toLowerCase() === lendingKey),
  });
  if (!created) return null;
  const contributed = created.args.actualBorrow;
  const fee = (contributed * BigInt(feeBps)) / BPS;
  return { loanId: created.args.loanId, contributed, net: contributed - fee };
}
