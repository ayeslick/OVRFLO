import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { eligibilityErrorNames, STALE_LIQUIDITY_REASONS, userFacingError } from "@/lib/errors";

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
    // Empty string, specifically: not-an-Error and not-throwing.
    expect(userFacingError("")).toBe("The transaction failed. Check the entered values and try again.");
  });

  it("walks a wrapped BaseError cause chain to find the nested revert (the real wagmi write-error shape)", () => {
    // wagmi's writeContract never throws a bare ContractFunctionRevertedError —
    // it's nested a few `cause` layers deep inside ContractFunctionExecutionError
    // / TransactionExecutionError. findRevert's BaseError.walk() must traverse that.
    const reverted = Object.assign(
      Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError,
      { data: { errorName: "MarketNotApproved" }, message: "reverted" },
    );
    const wrapped = new BaseError("Execution reverted", { cause: reverted });
    expect(userFacingError(wrapped)).toBe("This market is not approved for OVRFLO.");
  });

  it("falls through to message matching when the revert carries an unrecognized custom error name", () => {
    const reverted = Object.assign(
      Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError,
      {
        data: { errorName: "SomeFutureCustomError" },
        message: "execution reverted: OVRFLOLending: slippage",
      },
    );
    expect(userFacingError(reverted)).toBe("Price moved outside your limit.");
  });
});

describe("STALE_LIQUIDITY_REASONS", () => {
  it("maps every listed reason to its documented refresh-and-retry copy", () => {
    // A per-reason exact-copy table, not just "not the generic fallback" —
    // the weaker check would pass even if a reason were mapped to the wrong
    // (but still non-generic) message.
    const expectedCopy: Record<(typeof STALE_LIQUIDITY_REASONS)[number], string> = {
      "OVRFLOLending: liquidity inactive": "Liquidity changed since your quote. Refreshing market depth.",
      "OVRFLOLending: insufficient availableLiquidity": "This liquidity position cannot fill the quote.",
      "OVRFLOLending: duplicate or unsorted ids": "Liquidity IDs must be strictly increasing.",
      "OVRFLOLending: slippage": "Price moved outside your limit.",
    };
    for (const reason of STALE_LIQUIDITY_REASONS) {
      expect(userFacingError(new Error(`execution reverted: ${reason}`))).toBe(expectedCopy[reason]);
    }
  });
});

describe("eligibilityErrorNames", () => {
  it("locks in the full set of StreamPricing eligibility custom errors", () => {
    // Sorted both sides: eligibilityErrorNames is Object.keys(customErrorCopy),
    // so a cosmetic reordering of that map must not fail this test.
    expect([...eligibilityErrorNames].sort()).toEqual(
      [
        "MarketNotApproved",
        "WrongSender",
        "WrongAsset",
        "WrongEndTime",
        "SeriesMatured",
        "CliffPresent",
        "CancelableStream",
        "RemainingZero",
      ].sort(),
    );
  });
});
