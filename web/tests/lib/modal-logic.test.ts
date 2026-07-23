import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  applySlippageDown,
  applySlippageUp,
  borrowQuoteCopy,
  canCloseLoan,
  chooseSellNowLiquidity,
  isSeriesMatchedStream,
  repayMax,
  staleBatchCopy,
} from "@/lib/modal-logic";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const borrower = testAddress(0xb0b);

describe("write-flow decision helpers", () => {
  it("returns distinct borrow failure copy for insufficient, self-owned, and stale batches", () => {
    expect(
      borrowQuoteCopy({
        gatheredIds: [],
        sufficient: false,
        borrower,
        positionsAtRate: [],
      }),
    ).toBe("No liquidity is posted at this APR.");

    expect(
      borrowQuoteCopy({
        gatheredIds: [],
        sufficient: false,
        borrower,
        positionsAtRate: [{ id: 1n, lender: borrower, availableLiquidity: 1n }],
      }),
    ).toBe("Only your own liquidity is available at this APR.");

    expect(staleBatchCopy("execution reverted: OVRFLOLending: liquidity inactive")).toContain("Liquidity changed");
  });

  it("caps repay MAX to the smaller of wallet balance and outstanding", () => {
    const loan = { obligation: 100n, drawn: 20n, repaid: 5n };
    expect(repayMax(loan, 200n)).toBe(75n);
    expect(repayMax(loan, 10n)).toBe(10n);
  });

  it("allows close only when withdrawable covers outstanding", () => {
    const loan = { obligation: 100n, drawn: 20n, repaid: 5n, closed: false };
    expect(canCloseLoan({ loan, withdrawable: 74n })).toBe(false);
    expect(canCloseLoan({ loan, withdrawable: 75n })).toBe(true);
  });

  it("derives slippage bounds using integer math", () => {
    expect(applySlippageDown(1_000_000n, 50n)).toBe(995_000n);
    expect(applySlippageUp(1_000_000n, 50n)).toBe(1_005_000n);
  });

  it("filters streams by the selected series and picks sell-now liquidity", () => {
    const market = {
      vault: testAddress(1),
      treasury: testAddress(2),
      underlying: testAddress(3),
      ovrfloToken: testAddress(4),
      lending: testAddress(5),
      market: testAddress(6),
      twapDurationFixed: 900,
      feeBps: 0,
      expiryCached: 1782345600n,
      ptToken: testAddress(7),
      oracle: testAddress(8),
    };
    const stream = {
      streamId: 1n,
      recipient: borrower,
      sender: market.vault,
      asset: market.ovrfloToken,
      endTime: market.expiryCached,
      canceled: false,
      depleted: false,
      deposited: 100n,
      withdrawn: 0n,
      withdrawable: 0n,
    };

    expect(isSeriesMatchedStream(stream, market)).toBe(true);
    expect(
      chooseSellNowLiquidity({
        market,
        grossPrice: 50n,
        positions: [
          { id: 2n, lender: borrower, market: market.market, aprBps: 1000, availableLiquidity: 49n },
          { id: 3n, lender: borrower, market: market.market, aprBps: 1500, availableLiquidity: 100n },
          { id: 1n, lender: borrower, market: market.market, aprBps: 1000, availableLiquidity: 100n },
        ],
      })?.id,
    ).toBe(1n);
  });
});
