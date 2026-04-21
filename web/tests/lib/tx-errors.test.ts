import { describe, it, expect } from "vitest";

const { parseUserError } = await import("@/lib/tx-errors");

describe("tx error parsing", () => {
  it("translates wallet rejection", () => {
    expect(parseUserError(new Error("User rejected the request"))).toBe(
      "You rejected the wallet request."
    );
  });

  it("translates insufficient funds", () => {
    expect(parseUserError(new Error("insufficient funds for gas * price + value"))).toBe(
      "Insufficient ETH to pay for gas."
    );
  });

  it("translates slippage and expiry errors", () => {
    expect(parseUserError(new Error("OVRFLO: slippage"))).toContain("slippage");
    expect(parseUserError(new Error("OVRFLO: matured"))).toContain("matured");
  });
});
