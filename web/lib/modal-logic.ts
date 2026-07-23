import type { Address } from "viem";
import { classifyLiquidity, loanOutstanding } from "./lending-math";
import type { HeldStream, LiquidityPosition, Loan, MarketInfo } from "./types";

export const DEFAULT_SLIPPAGE_BPS = 50n;

export function borrowQuoteCopy({
  gatheredIds,
  sufficient,
  positionsAtRate,
  borrower,
}: {
  gatheredIds: bigint[];
  sufficient: boolean;
  positionsAtRate: Array<Pick<LiquidityPosition, "id" | "lender" | "availableLiquidity">>;
  borrower?: Address | null;
}) {
  const classification = classifyLiquidity({ gatheredIds, sufficient, positionsAtRate, borrower });
  if (classification.status === "sufficient") return "Liquidity available.";
  if (classification.status === "all-self-owned") return "Only your own liquidity is available at this APR.";
  if (classification.reason === "none-at-rate") return "No liquidity is posted at this APR.";
  return "Not enough liquidity is available at this APR.";
}

export function staleBatchCopy(message: string) {
  return message.includes("OVRFLOLending: liquidity inactive") ||
    message.includes("OVRFLOLending: insufficient availableLiquidity") ||
    message.includes("OVRFLOLending: duplicate or unsorted ids")
    ? "Liquidity changed since your quote. Refreshing market depth."
    : null;
}

export function repayMax(loan: Pick<Loan, "obligation" | "drawn" | "repaid">, walletBalance: bigint) {
  const outstanding = loanOutstanding(loan);
  return walletBalance < outstanding ? walletBalance : outstanding;
}

export function canCloseLoan({
  loan,
  withdrawable,
}: {
  loan: Pick<Loan, "closed" | "obligation" | "drawn" | "repaid">;
  withdrawable: bigint;
}) {
  if (loan.closed) return false;
  return withdrawable >= loanOutstanding(loan);
}

export function applySlippageDown(amount: bigint, slippageBps: bigint = DEFAULT_SLIPPAGE_BPS) {
  return (amount * (10_000n - slippageBps)) / 10_000n;
}

export function applySlippageUp(amount: bigint, slippageBps: bigint = DEFAULT_SLIPPAGE_BPS) {
  return (amount * (10_000n + slippageBps)) / 10_000n;
}

export function isSeriesMatchedStream(stream: HeldStream, market: MarketInfo) {
  return (
    stream.sender.toLowerCase() === market.vault.toLowerCase() &&
    stream.asset.toLowerCase() === market.ovrfloToken.toLowerCase() &&
    stream.endTime === market.expiryCached &&
    !stream.canceled &&
    !stream.depleted
  );
}

export function chooseSellNowLiquidity({
  positions,
  market,
  grossPrice,
}: {
  positions: LiquidityPosition[];
  market: MarketInfo;
  grossPrice: bigint;
}) {
  return positions
    .filter(
      (position) =>
        position.market.toLowerCase() === market.market.toLowerCase() &&
        position.availableLiquidity >= grossPrice,
    )
    .sort((a, b) => {
      if (a.aprBps !== b.aprBps) return a.aprBps - b.aprBps;
      return a.id < b.id ? -1 : 1;
    })[0];
}
