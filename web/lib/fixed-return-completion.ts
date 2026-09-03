/**
 * Fixed Return completion copy. Exact return and date appear only after
 * authoritative position and loan reads establish both.
 */

export type FixedReturnLoanTerm = {
  loanId: bigint;
  matchedAmount: bigint;
  completionDate: bigint;
};

export type FixedReturnCompletion =
  | { status: "waiting"; withdrawable: true }
  | { status: "partial-waiting"; withdrawable: true; unfilled: bigint }
  | {
      status: "single-term";
      matchedAmount: bigint;
      completionDate: bigint;
      unfilled: bigint;
      withdrawableUnfilled: boolean;
    }
  | {
      status: "multiple-dates";
      summary: "Multiple completion dates";
      loans: readonly FixedReturnLoanTerm[];
      unfilled: bigint;
      withdrawableUnfilled: boolean;
    }
  | { status: "incomplete-reads" };

export function describeFixedReturnCompletion(args: {
  filled: bigint;
  unfilled: bigint;
  loans: readonly FixedReturnLoanTerm[] | null;
}): FixedReturnCompletion {
  if (args.filled === 0n) {
    return { status: "waiting", withdrawable: true };
  }
  if (args.loans === null) {
    return { status: "incomplete-reads" };
  }
  const established = args.loans.filter(
    (loan) => loan.matchedAmount > 0n && loan.completionDate > 0n,
  );
  const matchedFromLoans = established.reduce((sum, loan) => sum + loan.matchedAmount, 0n);
  if (established.length === 0 || matchedFromLoans !== args.filled) {
    return { status: "incomplete-reads" };
  }
  const withdrawableUnfilled = args.unfilled > 0n;
  if (established.length === 1) {
    const [loan] = established;
    return {
      status: "single-term",
      matchedAmount: loan!.matchedAmount,
      completionDate: loan!.completionDate,
      unfilled: args.unfilled,
      withdrawableUnfilled,
    };
  }
  return {
    status: "multiple-dates",
    summary: "Multiple completion dates",
    loans: established,
    unfilled: args.unfilled,
    withdrawableUnfilled,
  };
}
