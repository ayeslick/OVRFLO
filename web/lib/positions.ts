import { parseEventLogs, type Address, type Log } from "viem";
import { ovrfloLendingAbi } from "./generated";
import { aprChoices, loanOutstanding, upfrontBps } from "./lending-math";
import { classifyBorrowError, resolveSelectedTick, type BorrowErrorKind } from "./borrow";
import { buildLadder, type TickDepth } from "./router";
import type { Loan, LiquidityPosition, LoanPool } from "./types";

// Pure card-state logic for the positions panel (ticket 08).

// Three distinct loan card states — "residual" (obligation met, stream still
// returning to the borrower) is deliberately not lumped in with "settled".
export type LoanCardState = "repaying" | "residual" | "settled";

export function loanCardState(loan: Pick<Loan, "obligation" | "drawn" | "repaid" | "closed">): LoanCardState {
  if (loan.closed) return "settled";
  return loanOutstanding(loan) > 0n ? "repaying" : "residual";
}

// Whole-percent repayment progress of a loan, floored and clamped to [0, 100].
export function obligationPct(loan: Pick<Loan, "obligation" | "drawn" | "repaid">): number {
  if (loan.obligation === 0n) return 100;
  const satisfied = loan.drawn + loan.repaid;
  if (satisfied >= loan.obligation) return 100;
  return Number((satisfied * 100n) / loan.obligation);
}

// Whole-percent progress of a stream: withdrawn plus currently claimable,
// floored and clamped to [0, 100].
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

// Shared "this user's rows for this market" selectors — used by both
// PositionList (per-market detail) and PositionSummary (cross-market
// aggregate) so the market-matching filter can't drift between the two.
// Take the market address (not the full MarketInfo) so callers can keep
// depending on the primitive string in a useMemo/useEffect deps array
// instead of the market object's identity.
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

export function selectForMarket<T extends { pool: Pick<LoanPool, "market"> }>(
  rows: readonly T[],
  marketAddress: Address,
) {
  const marketKey = marketAddress.toLowerCase();
  return rows.filter(({ pool }) => pool.market.toLowerCase() === marketKey);
}

// "You could borrow ~X% upfront" teaser: priced at the lowest tick with real
// liquidity (the ladder's best rate). Null when nothing is borrowable.
export function borrowTeaserBps(ladder: TickDepth[], ttmSeconds: bigint, feeBps: number): bigint | null {
  const best = resolveSelectedTick(ladder, null);
  if (best === null) return null;
  return upfrontBps(best, ttmSeconds, feeBps);
}

// Market-level teaser from raw reads: builds the tick ladder, then prices the
// best liquid tick. Null means no postable (non-self) liquidity at any rate —
// the one definition of "empty" shared by the stream cards and the market-row
// BORROW gate, so the two can never drift apart on what empty means.
export function marketBorrowTeaserBps({
  liquidity,
  market,
  aprMinBps,
  aprMaxBps,
  feeBps,
  ttmSeconds,
  matured,
  self,
}: {
  liquidity: LiquidityPosition[];
  market: Address;
  aprMinBps: number;
  aprMaxBps: number;
  feeBps: number;
  ttmSeconds: bigint;
  matured: boolean;
  self?: Address;
}): bigint | null {
  if (matured) return null;
  const ticks = [
    ...new Set([
      ...(aprMaxBps > 0 ? aprChoices(aprMinBps, aprMaxBps) : []),
      ...liquidity
        .filter(
          (position) =>
            position.market.toLowerCase() === market.toLowerCase(),
        )
        .map((position) => position.aprBps),
    ]),
  ].sort((left, right) => left - right);
  return borrowTeaserBps(buildLadder(liquidity, market, ticks, self), ttmSeconds, feeBps);
}

// The receipt is the source of truth for what an adjust-rate actually did.
// supplyLiquidity supplies exactly the amount it was asked for, so the
// interesting comparison is against the WITHDRAW leg: if the position shrank
// between the fresh read and execution, `refunded < moved` and the difference
// was pulled from the lender's wallet — that must be surfaced, never silent.
export function adjustReceiptSummary(
  logs: Log[],
  lending: Address,
): { liquidityId: bigint; aprBps: number; moved: bigint; refunded: bigint } | null {
  const lendingLogs = logs.filter((log) => log.address.toLowerCase() === lending.toLowerCase());
  const [supplied] = parseEventLogs({
    abi: ovrfloLendingAbi,
    eventName: "LiquiditySupplied",
    logs: lendingLogs,
  });
  if (!supplied) return null;
  const [withdrawn] = parseEventLogs({
    abi: ovrfloLendingAbi,
    eventName: "LiquidityWithdrawn",
    logs: lendingLogs,
  });
  return {
    liquidityId: supplied.args.liquidityId,
    aprBps: supplied.args.aprBps,
    moved: supplied.args.availableLiquidity,
    refunded: withdrawn?.args.refunded ?? supplied.args.availableLiquidity,
  };
}

// Adjust-rate error classification: on top of the ticket-06 stale set, an
// ERC20 balance shortfall in this flow means the position shrank after the
// fresh read and the wallet could not cover the difference — a liquidity
// race, so it recovers via re-quote, not a dead-end error.
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
