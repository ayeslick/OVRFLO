import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  applySlippageDown,
  applySlippageUp,
  canCloseLoan,
  isSeriesMatchedStream,
  repayMax,
} from "@/lib/modal-logic";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const borrower = testAddress(0xb0b);

describe("write-flow decision helpers", () => {
  it("caps repay MAX to the smaller of wallet balance and outstanding", () => {
    const loan = { obligation: 100n, drawn: 20n, repaid: 5n };
    expect(repayMax(loan, 200n)).toBe(75n);
    expect(repayMax(loan, 10n)).toBe(10n);
  });

  it("returns zero for repayMax once the obligation is already fully satisfied", () => {
    const settled = { obligation: 100n, drawn: 100n, repaid: 0n };
    expect(repayMax(settled, 500n)).toBe(0n);
  });

  it("allows close only when withdrawable covers outstanding", () => {
    const loan = { obligation: 100n, drawn: 20n, repaid: 5n, closed: false };
    expect(canCloseLoan({ loan, withdrawable: 74n })).toBe(false);
    expect(canCloseLoan({ loan, withdrawable: 75n })).toBe(true);
  });

  it("never allows re-closing an already-closed loan, even with ample withdrawable", () => {
    const closed = { obligation: 100n, drawn: 20n, repaid: 5n, closed: true };
    expect(canCloseLoan({ loan: closed, withdrawable: 1_000_000n })).toBe(false);
  });

  it("derives slippage bounds using integer math", () => {
    expect(applySlippageDown(1_000_000n, 50n)).toBe(995_000n);
    expect(applySlippageUp(1_000_000n, 50n)).toBe(1_005_000n);
  });

  it("leaves the amount unchanged at zero slippage tolerance", () => {
    expect(applySlippageDown(1_000_000n, 0n)).toBe(1_000_000n);
    expect(applySlippageUp(1_000_000n, 0n)).toBe(1_000_000n);
  });

  it("floors a fractional result rather than rounding", () => {
    // 1 * 9950 / 10000 = 0.995 -> floor 0, not round-to-1.
    expect(applySlippageDown(1n, 50n)).toBe(0n);
    // 1 * 19999 / 10000 = 1.9999 -> floor 1, not round-to-2.
    expect(applySlippageUp(1n, 9_999n)).toBe(1n);
  });

  it("filters streams by the selected series", () => {
    const market = {
      vault: testAddress(1),
      treasury: testAddress(2),
      underlying: testAddress(3),
      ovrfloToken: testAddress(4),
      reserve: testAddress(9),
      lending: testAddress(5),
      market: testAddress(6),
      twapDurationFixed: 900,
      feeBps: 0,
      expiryCached: 1782345600n,
      ptToken: testAddress(7),
      oracle: testAddress(8),
      retiredLendings: [],
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
    expect(isSeriesMatchedStream({ ...stream, canceled: true }, market)).toBe(false);
    expect(isSeriesMatchedStream({ ...stream, depleted: true }, market)).toBe(false);
    expect(isSeriesMatchedStream({ ...stream, sender: testAddress(99) }, market)).toBe(false);
    expect(isSeriesMatchedStream({ ...stream, asset: testAddress(99) }, market)).toBe(false);
    expect(isSeriesMatchedStream({ ...stream, endTime: stream.endTime + 1n }, market)).toBe(false);
  });

  it("uses the default slippage bound when none is given", () => {
    expect(applySlippageDown(1_000_000n)).toBe(995_000n);
    expect(applySlippageUp(1_000_000n)).toBe(1_005_000n);
  });
});
