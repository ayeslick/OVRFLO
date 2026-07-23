import { describe, expect, it } from "vitest";
import { classifyLiquidity, isLoanOpen, loanOutstanding, loanPoolClaimable, recoveredForClaimable } from "@/lib/lending-math";

const lender = "0x0000000000000000000000000000000000000a11" as const;
const borrower = "0x0000000000000000000000000000000000000b0b" as const;

describe("lending math", () => {
  it("computes outstanding from obligation, drawn, and repaid in exactly one helper", () => {
    expect(loanOutstanding({ obligation: 100n, drawn: 30n, repaid: 25n })).toBe(45n);
    expect(loanOutstanding({ obligation: 100n, drawn: 100n, repaid: 25n })).toBe(0n);
  });

  it("treats closed loans and fully satisfied loans as not open", () => {
    expect(isLoanOpen({ obligation: 100n, drawn: 50n, repaid: 0n, closed: false })).toBe(true);
    expect(isLoanOpen({ obligation: 100n, drawn: 100n, repaid: 0n, closed: false })).toBe(false);
    expect(isLoanOpen({ obligation: 100n, drawn: 50n, repaid: 0n, closed: true })).toBe(false);
  });

  it("computes pro-rata loan pool claimable less already received", () => {
    expect(
      loanPoolClaimable({
        contribution: 25n,
        received: 5n,
        recovered: 80n,
        totalContributed: 100n,
      }),
    ).toBe(15n);
  });

  it("caps open-stream recovery at outstanding debt", () => {
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: false },
        withdrawable: 90n,
      }),
    ).toBe(100n);
  });

  it("distinguishes insufficient liquidity from all-self-owned liquidity", () => {
    expect(
      classifyLiquidity({
        gatheredIds: [],
        sufficient: false,
        borrower,
        positionsAtRate: [{ id: 1n, lender: borrower, availableLiquidity: 10n }],
      }).status,
    ).toBe("all-self-owned");

    expect(
      classifyLiquidity({
        gatheredIds: [],
        sufficient: false,
        borrower,
        positionsAtRate: [{ id: 1n, lender, availableLiquidity: 10n }],
      }),
    ).toEqual({ status: "insufficient", reason: "not-enough", ids: [] });
  });
});
