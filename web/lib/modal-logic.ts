import { loanOutstanding } from "./lending-math";
import type { HeldStream, Loan, MarketInfo } from "./types";

export const DEFAULT_SLIPPAGE_BPS = 50n;

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

