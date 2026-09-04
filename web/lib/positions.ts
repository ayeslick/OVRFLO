import type { Address } from "viem";
import { loanOutstanding } from "./lending-math";
import { classifyBorrowError, type BorrowErrorKind } from "./borrow";
import type { Loan, LiquidityPosition } from "./types";

// Pure card-state logic. Old-ABI receipt/pool branches were purged in U1.

export type LoanCardState = "repaying" | "residual" | "settled";

export function loanCardState(loan: Pick<Loan, "obligation" | "drawn" | "repaid" | "closed">): LoanCardState {
  if (loan.closed) return "settled";
  return loanOutstanding(loan) > 0n ? "repaying" : "residual";
}

export function obligationPct(loan: Pick<Loan, "obligation" | "drawn" | "repaid">): number {
  if (loan.obligation === 0n) return 100;
  const satisfied = loan.drawn + loan.repaid;
  if (satisfied >= loan.obligation) return 100;
  return Number((satisfied * 100n) / loan.obligation);
}

export function streamedPct({
  deposited,
  withdrawn,
  withdrawable,
}: {
  deposited: bigint;
  withdrawn: bigint;
  withdrawable: bigint;
}): number {
  if (deposited === 0n) return 0;
  const streamed = withdrawn + withdrawable;
  if (streamed >= deposited) return 100;
  return Number((streamed * 100n) / deposited);
}

export function selectLiquidityForLender(
  liquidity: readonly LiquidityPosition[],
  marketAddress: Address,
  normalizedUser: string | undefined,
) {
  const marketKey = marketAddress.toLowerCase();
  return liquidity.filter(
    (position) =>
      position.market.toLowerCase() === marketKey &&
      Boolean(normalizedUser) &&
      position.lender.toLowerCase() === normalizedUser,
  );
}

const ADJUST_STALE_PATTERNS = [
  "transfer amount exceeds balance",
  "ERC20InsufficientBalance",
  "TransferFromFailed",
];

export function classifyAdjustError(error: unknown): BorrowErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (ADJUST_STALE_PATTERNS.some((pattern) => message.includes(pattern))) return "stale";
  return classifyBorrowError(error);
}
