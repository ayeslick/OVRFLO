import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { ZERO_ADDRESS } from "@/lib/config";
import { cs3ContinuationAvailable, depositPlusBorrowLiquidityGate } from "@/lib/no-liquidity-gate";

const BOOK = "0x00000000000000000000000000000000000000b0" as Address;

describe("no-liquidity deposit-plus-borrow gate", () => {
  it("blocks before deposit when borrow is not executable and CS3 is absent", () => {
    expect(cs3ContinuationAvailable()).toBe(false);
    expect(cs3ContinuationAvailable(null)).toBe(false);
    expect(cs3ContinuationAvailable(ZERO_ADDRESS)).toBe(false);
    expect(
      depositPlusBorrowLiquidityGate({ borrowExecutable: false, cs3Available: false }),
    ).toEqual({ status: "blocked", reason: "no-liquidity-without-cs3" });
  });

  it("allows the composition when immediate borrow is executable", () => {
    expect(
      depositPlusBorrowLiquidityGate({ borrowExecutable: true, cs3Available: false }),
    ).toEqual({ status: "proceed", reason: "immediate-borrow-executable" });
  });

  it("offers a request continuation when the router is a live book", () => {
    expect(cs3ContinuationAvailable(BOOK)).toBe(true);
    expect(
      depositPlusBorrowLiquidityGate({ borrowExecutable: false, cs3Available: true }),
    ).toEqual({ status: "request", reason: "cs3-continuation" });
  });
});
