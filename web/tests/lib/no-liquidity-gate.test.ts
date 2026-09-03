import { describe, expect, it } from "vitest";
import { cs3ContinuationAvailable, depositPlusBorrowLiquidityGate } from "@/lib/no-liquidity-gate";

describe("no-liquidity deposit-plus-borrow gate", () => {
  it("blocks before deposit when borrow is not executable and CS3 is absent", () => {
    expect(cs3ContinuationAvailable()).toBe(false);
    expect(
      depositPlusBorrowLiquidityGate({ borrowExecutable: false, cs3Available: false }),
    ).toEqual({ status: "blocked", reason: "no-liquidity-without-cs3" });
  });

  it("allows the composition when immediate borrow is executable", () => {
    expect(
      depositPlusBorrowLiquidityGate({ borrowExecutable: true, cs3Available: false }),
    ).toEqual({ status: "proceed", reason: "immediate-borrow-executable" });
  });
});
