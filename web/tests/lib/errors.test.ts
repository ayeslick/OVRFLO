import { describe, expect, it } from "vitest";
import { ContractFunctionRevertedError } from "viem";
import { userFacingError } from "@/lib/errors";

describe("userFacingError", () => {
  it("maps the current lending stale-liquidity string to refresh copy", () => {
    expect(userFacingError(new Error("execution reverted: OVRFLOLending: liquidity inactive"))).toContain(
      "Liquidity changed since your quote",
    );
  });

  it("does not include deleted custom errors in user copy", () => {
    const source = userFacingError.toString();
    expect(source).not.toContain("SeriesNotApproved");
    expect(source).not.toContain("CoreNotRegistered");
  });

  it("prefers the custom error name when a revert carries one", () => {
    const reverted = Object.assign(
      Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError,
      { data: { errorName: "CancelableStream" }, message: "reverted" },
    );
    expect(userFacingError(reverted)).toBe("Cancelable streams are not eligible.");
  });

  it("maps a matched revert reason string", () => {
    expect(userFacingError(new Error("execution reverted: OVRFLOLending: self-match"))).toBe(
      "You cannot borrow from your own liquidity.",
    );
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(userFacingError(new Error("boom"))).toBe(
      "The transaction failed. Check the entered values and try again.",
    );
    expect(userFacingError("not-an-error")).toBe(
      "The transaction failed. Check the entered values and try again.",
    );
  });
});
