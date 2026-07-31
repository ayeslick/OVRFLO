import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { useLoanBook } from "@/hooks/useLoanBook";
import { readyOutcome } from "@/lib/read-outcome";

const LENDING = "0x00000000000000000000000000000000000000a1" as Address;
const USER = "0x00000000000000000000000000000000000000b2" as Address;
const projection = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/hooks/useLendingProjection", () => ({
  useAccountLoanBookProjection: () => projection.current,
}));

describe("useLoanBook — U9 projection adapter", () => {
  it("exposes directly hydrated pool and borrower rows", () => {
    const row = {
      pool: { id: 701n, borrower: USER, aprBps: 1_000, market: USER, totalContributed: 5n },
      loan: { id: 701n, borrower: USER, streamId: 9n, obligation: 6n, drawn: 1n, repaid: 0n, closed: false },
      contribution: 5n,
      received: 0n,
      withdrawable: 1n,
      claimable: 1n,
    };
    projection.current = {
      outcome: readyOutcome({ pools: [row], loans: [row], liquidityPositions: [], lenderLoanIds: [701n], borrowerLoans: [], ledger: {} }),
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLoanBook(LENDING, USER));
    expect(result.current.pools[0].pool.id).toBe(701n);
    expect(result.current.loans[0].loan.id).toBe(701n);
  });
});
