import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useLoanBook } from "@/hooks/useLoanBook";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const LENDING = testAddress(5);
const LENDER = testAddress(0xa11);
const BORROWER = testAddress(0xb0b);

vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 1200, feeBps: 0, nextLiquidityId: 1n, nextLoanId: 3n, nextSaleListingId: 1n },
    isLoading: false,
    error: null,
  }),
}));

// id 1: LENDER contributed, no borrow by LENDER. id 2: BORROWER's own loan,
// LENDER never contributed. Both ids share nothing so the two derived views
// (pools by contribution, loans by borrower) don't overlap — the shared
// withdrawable batch is still exercised once per relevant row.
const success = (result: unknown) => ({ status: "success" as const, result });

vi.mock("wagmi", () => ({
  useReadContracts: (config: { contracts: Array<{ functionName?: string }> }) => {
    const first = config.contracts[0]?.functionName;
    if (first === "withdrawableAmountOf") {
      return { data: config.contracts.map(() => success(7n * WAD)), isLoading: false, error: null };
    }
    // Main batch: 5 reads per id, ids [1, 2] -> 10 entries.
    return {
      data: [
        // id 1 — LENDER's own pool, no contribution from BORROWER.
        success([LENDER, 1000, testAddress(6), 100n * WAD]), // loanPools
        success([LENDER, 1n, 100n * WAD, 20n * WAD, 0n, false]), // loans
        success(50n * WAD), // loanPoolContributions(1, LENDER)
        success(10n * WAD), // loanPoolReceived(1, LENDER)
        success(30n * WAD), // loanPoolProceeds(1)
        // id 2 — BORROWER's own loan pool, LENDER never contributed.
        success([BORROWER, 1100, testAddress(6), 200n * WAD]), // loanPools
        success([BORROWER, 2n, 200n * WAD, 0n, 0n, false]), // loans
        success(0n), // loanPoolContributions(2, LENDER)
        success(0n), // loanPoolReceived(2, LENDER)
        success(0n), // loanPoolProceeds(2)
      ],
      isLoading: false,
      error: null,
    };
  },
}));

describe("useLoanBook", () => {
  it("derives the pools view from contribution > 0 only", () => {
    const { result } = renderHook(() => useLoanBook(LENDING, LENDER));
    expect(result.current.pools).toHaveLength(1);
    expect(result.current.pools[0].pool.id).toBe(1n);
    expect(result.current.pools[0].withdrawable).toBe(7n * WAD);
  });

  it("derives the loans view from borrower match only, independent of contribution", () => {
    const { result } = renderHook(() => useLoanBook(LENDING, BORROWER));
    expect(result.current.loans).toHaveLength(1);
    expect(result.current.loans[0].loan.id).toBe(2n);
    expect(result.current.loans[0].withdrawable).toBe(7n * WAD);
  });

  it("reports tooLarge from the same nextLoanId threshold both prior hooks used", () => {
    const { result } = renderHook(() => useLoanBook(LENDING, LENDER));
    expect(result.current.tooLarge).toBe(false);
  });
});
