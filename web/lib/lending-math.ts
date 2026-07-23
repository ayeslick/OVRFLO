import type { Address } from "viem";
import { ZERO_ADDRESS } from "./config";
import type { LiquidityPosition, Loan, LoanPool } from "./types";

export const APR_STEP_BPS = 100;
export const MAX_ENUMERATION_IDS = 500n;
export const MAX_UINT128 = (1n << 128n) - 1n;

export function loanOutstanding(loan: Pick<Loan, "obligation" | "drawn" | "repaid">) {
  const satisfied = loan.drawn + loan.repaid;
  return satisfied >= loan.obligation ? 0n : loan.obligation - satisfied;
}

export function isLoanOpen(loan: Pick<Loan, "closed" | "obligation" | "drawn" | "repaid">) {
  return !loan.closed && loanOutstanding(loan) > 0n;
}

export function loanPoolClaimable({
  contribution,
  received,
  recovered,
  totalContributed,
}: {
  contribution: bigint;
  received: bigint;
  recovered: bigint;
  totalContributed: bigint;
}) {
  if (contribution === 0n || totalContributed === 0n) return 0n;
  const entitled = (contribution * recovered) / totalContributed;
  return entitled > received ? entitled - received : 0n;
}

export function recoveredForClaimable({
  loan,
  withdrawable,
}: {
  loan: Pick<Loan, "drawn" | "repaid" | "closed" | "obligation">;
  withdrawable: bigint;
}) {
  const outstanding = loanOutstanding(loan);
  const pendingStreamRecovery = loan.closed ? 0n : withdrawable < outstanding ? withdrawable : outstanding;
  return loan.drawn + loan.repaid + pendingStreamRecovery;
}

export function aprChoices(minBps: number, maxBps: number, stepBps = APR_STEP_BPS) {
  const choices: number[] = [];
  for (let aprBps = minBps; aprBps <= maxBps; aprBps += stepBps) {
    choices.push(aprBps);
  }
  return choices;
}

export type LiquidityClassification =
  | { status: "sufficient"; ids: bigint[] }
  | { status: "insufficient"; reason: "none-at-rate" | "not-enough"; ids: bigint[] }
  | { status: "all-self-owned"; ids: bigint[] };

export function classifyLiquidity({
  gatheredIds,
  sufficient,
  positionsAtRate,
  borrower,
}: {
  gatheredIds: bigint[];
  sufficient: boolean;
  positionsAtRate: Array<Pick<LiquidityPosition, "id" | "lender" | "availableLiquidity">>;
  borrower?: Address | null;
}): LiquidityClassification {
  if (sufficient) return { status: "sufficient", ids: gatheredIds };

  const openPositions = positionsAtRate.filter((position) => position.availableLiquidity > 0n);
  if (openPositions.length === 0) {
    return { status: "insufficient", reason: "none-at-rate", ids: gatheredIds };
  }

  const normalizedBorrower = borrower?.toLowerCase();
  const hasOnlySelfLiquidity =
    Boolean(normalizedBorrower) &&
    openPositions.every((position) => position.lender.toLowerCase() === normalizedBorrower);

  if (hasOnlySelfLiquidity) return { status: "all-self-owned", ids: gatheredIds };
  return { status: "insufficient", reason: "not-enough", ids: gatheredIds };
}

export function liquidityExists(position: Pick<LiquidityPosition, "lender">) {
  return position.lender !== ZERO_ADDRESS;
}

export function loanExists(loan: Pick<Loan, "borrower">) {
  return loan.borrower !== ZERO_ADDRESS;
}

export function poolExists(pool: Pick<LoanPool, "borrower">) {
  return pool.borrower !== ZERO_ADDRESS;
}
