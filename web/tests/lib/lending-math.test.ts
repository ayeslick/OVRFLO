import { describe, expect, it } from "vitest";
import {
  aprChoices,
  classifyLiquidity,
  enumerateIds,
  isLoanOpen,
  liquidityExists,
  loanExists,
  loanOutstanding,
  loanPoolClaimable,
  MAX_ENUMERATION_IDS,
  poolExists,
  recoveredForClaimable,
} from "@/lib/lending-math";
import { ZERO_ADDRESS } from "@/lib/config";

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

  it("classifies sufficient batches and empty rates", () => {
    expect(classifyLiquidity({ gatheredIds: [1n, 2n], sufficient: true, positionsAtRate: [] })).toEqual({
      status: "sufficient",
      ids: [1n, 2n],
    });
    expect(
      classifyLiquidity({
        gatheredIds: [],
        sufficient: false,
        borrower,
        positionsAtRate: [{ id: 1n, lender, availableLiquidity: 0n }],
      }),
    ).toEqual({ status: "insufficient", reason: "none-at-rate", ids: [] });
  });

  it("treats liquidity as self-owned only when a borrower is known", () => {
    expect(
      classifyLiquidity({
        gatheredIds: [],
        sufficient: false,
        borrower: null,
        positionsAtRate: [{ id: 1n, lender: borrower, availableLiquidity: 10n }],
      }),
    ).toEqual({ status: "insufficient", reason: "not-enough", ids: [] });
  });

  it("enumerates 1-based ids, caps at the enumeration limit, and never underflows", () => {
    expect(enumerateIds(4n)).toEqual([1n, 2n, 3n]);
    expect(enumerateIds(1n)).toEqual([]);
    expect(enumerateIds(0n)).toEqual([]);
    const capped = enumerateIds(MAX_ENUMERATION_IDS + 50n);
    expect(capped.length).toBe(Number(MAX_ENUMERATION_IDS));
    expect(capped[0]).toBe(1n);
    expect(capped[capped.length - 1]).toBe(MAX_ENUMERATION_IDS);
    expect(enumerateIds(6n, 2n)).toEqual([1n, 2n]);
  });

  it("builds inclusive APR ladders on the step and handles empty ranges", () => {
    expect(aprChoices(1000, 1300)).toEqual([1000, 1100, 1200, 1300]);
    expect(aprChoices(1000, 1000)).toEqual([1000]);
    expect(aprChoices(1300, 1000)).toEqual([]);
  });

  it("detects presence by non-zero owner address", () => {
    expect(liquidityExists({ lender })).toBe(true);
    expect(liquidityExists({ lender: ZERO_ADDRESS })).toBe(false);
    expect(loanExists({ borrower })).toBe(true);
    expect(loanExists({ borrower: ZERO_ADDRESS })).toBe(false);
    expect(poolExists({ borrower })).toBe(true);
    expect(poolExists({ borrower: ZERO_ADDRESS })).toBe(false);
  });

  it("drops pending stream recovery once a loan is closed", () => {
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: true },
        withdrawable: 90n,
      }),
    ).toBe(30n);
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: false },
        withdrawable: 5n,
      }),
    ).toBe(35n);
  });
});
