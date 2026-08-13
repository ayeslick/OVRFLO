import type { EntityRowState } from "@/components/kit/EntityRow";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { HydratedStream } from "@/hooks/useStreams";
import { formatAprBps, formatCoverDate, formatTruncatedDecimal } from "./format";
import { canCloseLoan } from "./modal-logic";
import { coverDate, interpolateOutstanding, type StreamSchedule } from "./payoff";
import { isLoanOpen, loanOutstanding } from "./lending-math";

export function positionFilled(row: Pick<LenderPositionRow, "intervalStart" | "intervalEnd">): bigint {
  const filled = row.intervalEnd - row.intervalStart;
  return filled < 0n ? 0n : filled;
}

export function positionClaimable(row: Pick<LenderPositionRow, "pairs">): bigint {
  return row.pairs.reduce((sum, pair) => sum + pair.claimable, 0n);
}

export function suppliedMatchState(filled: bigint, unfilled: bigint): Extract<
  EntityRowState,
  "resting" | "partial" | "filled"
> {
  if (filled === 0n) return "resting";
  if (unfilled === 0n) return "filled";
  return "partial";
}

export function formatWatchAmount(value: bigint, displayDecimals = 5): string {
  return formatTruncatedDecimal(value, 18, displayDecimals);
}

export function suppliedStateLine(args: {
  match: "resting" | "partial" | "filled";
  filled: bigint;
  unfilled: bigint;
  aprBps: number;
}): string {
  if (args.match === "resting") return "NOTHING ACCRUES UNTIL MATCHED";
  const total = args.filled + args.unfilled;
  return `FILLED ${formatWatchAmount(args.filled)} / ${formatWatchAmount(total)} @ ${formatAprBps(args.aprBps)}`;
}

export function fraction01(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole) / 10_000;
}

export function borrowedRowState(args: {
  loan: Pick<BorrowerLoanRow, "closed" | "obligation" | "drawn" | "repaid" | "outstanding">;
  withdrawable?: bigint;
}): Extract<EntityRowState, "repaying" | "close-ready" | "settled"> {
  if (args.loan.closed || args.loan.outstanding === 0n || !isLoanOpen(args.loan)) {
    return "settled";
  }
  if (args.withdrawable !== undefined && canCloseLoan({ loan: args.loan, withdrawable: args.withdrawable })) {
    return "close-ready";
  }
  return "repaying";
}

export function borrowedStateLine(args: {
  state: "repaying" | "close-ready" | "settled";
  streamId: bigint;
  coverAt?: bigint;
}): string {
  if (args.state === "settled") return `RETURNED STREAM #${args.streamId.toString()}`;
  if (args.state === "close-ready") return "COVERED · CLOSE FROM STREAM";
  if (args.coverAt !== undefined) {
    return `${formatCoverDate(args.coverAt).toUpperCase()} · STREAM REPAYING`;
  }
  return "STREAM REPAYING";
}

export function streamRowState(stream: Pick<HydratedStream, "borrowRouteEligible" | "remaining">, pledged: boolean): Extract<
  EntityRowState,
  "eligible" | "pledged" | "vesting"
> {
  if (pledged) return "pledged";
  if (stream.borrowRouteEligible && stream.remaining > 0n) return "eligible";
  return "vesting";
}

export function streamStateLine(args: { state: "eligible" | "pledged" | "vesting"; loanId?: bigint }): string {
  if (args.state === "pledged") {
    return args.loanId !== undefined ? `PLEDGED TO LOAN #${args.loanId.toString()}` : "PLEDGED";
  }
  if (args.state === "eligible") return "UNPLEDGED · ROUTE INTO BORROW";
  return "UNPLEDGED · VESTING";
}

export function loanCoverAt(schedule: StreamSchedule | undefined, outstanding: bigint, now: bigint): bigint | undefined {
  if (!schedule) return undefined;
  const cover = coverDate(schedule, outstanding, now);
  if (cover.status === "uncovered") return undefined;
  return cover.at;
}

export function displayedOutstanding(args: {
  schedule?: StreamSchedule;
  lastOutstanding: bigint;
  lastReadAt: bigint;
  now: bigint;
  closeReady: boolean;
}): bigint {
  if (args.closeReady) return args.lastOutstanding;
  if (!args.schedule) return args.lastOutstanding;
  return interpolateOutstanding(args.schedule, args.lastOutstanding, args.lastReadAt, args.now);
}

export function sortBorrowedLoans<T extends { closed: boolean; outstanding: bigint }>(loans: readonly T[]): T[] {
  const active: T[] = [];
  const settled: T[] = [];
  for (const loan of loans) {
    if (loan.closed || loan.outstanding === 0n) settled.push(loan);
    else active.push(loan);
  }
  return [...active, ...settled];
}

export { loanOutstanding };
