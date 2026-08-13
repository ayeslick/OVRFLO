import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import {
  belowMinimumCopy,
  decodeContractError,
  disambiguateBelowMinimum,
  eligibilityErrorNames,
  errorCatalog,
  generatedErrorNames,
  isRevertFailure,
  isUserRejection,
  STALE_LIQUIDITY_REASONS,
  userFacingError,
} from "@/lib/errors";
import { MIN_LIQUIDITY_AMOUNT, MIN_STREAM_AMOUNT } from "@/lib/lending-math";

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

function revertedWith(errorName: string) {
  return Object.assign(Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError, {
    data: { errorName },
    message: "reverted",
  });
}

describe("ABI-enumerated error catalog", () => {
  it("decodes every generated ABI error to copy plus one recovery action", () => {
    expect(generatedErrorNames.length).toBeGreaterThan(0);
    expect([...generatedErrorNames].sort()).toEqual(Object.keys(errorCatalog).sort());

    for (const name of generatedErrorNames) {
      const decoded = decodeContractError(revertedWith(name));
      expect(decoded.name, name).toBe(name);
      expect(decoded.copy.length, name).toBeGreaterThan(0);
      expect(decoded.recovery.id, name).toBeTruthy();
      expect(decoded.recovery.label.length, name).toBeGreaterThan(0);
      if (name !== "BelowMinimum") {
        expect(decoded.copy).toBe(errorCatalog[name].copy);
        expect(decoded.recovery).toEqual(errorCatalog[name].recovery);
      }
    }
  });
});

describe("BelowMinimum disambiguation", () => {
  it("classifies stream-face when remaining is below MIN_STREAM_AMOUNT", () => {
    expect(disambiguateBelowMinimum({ remaining: MIN_STREAM_AMOUNT - 1n })).toBe("stream-face");
    expect(belowMinimumCopy("stream-face")).toBe(
      "This stream's remaining value is below the minimum to borrow against.",
    );
  });

  it("classifies fill-floor when the fill is below MIN_LIQUIDITY_AMOUNT", () => {
    expect(
      disambiguateBelowMinimum({
        remaining: 10n ** 18n,
        actualBorrow: MIN_LIQUIDITY_AMOUNT - 1n,
      }),
    ).toBe("fill-floor");
    expect(belowMinimumCopy("fill-floor")).toBe("This tick does not have enough resting liquidity to fill.");
  });

  it("decodes BelowMinimum with stream fixtures to the matching copy and recovery", () => {
    const streamFace = decodeContractError(revertedWith("BelowMinimum"), {
      remaining: MIN_STREAM_AMOUNT - 1n,
    });
    expect(streamFace.copy).toBe(belowMinimumCopy("stream-face"));
    expect(streamFace.recovery.id).toBe("change-stream");

    const fillFloor = decodeContractError(revertedWith("BelowMinimum"), {
      remaining: 10n ** 18n,
      actualBorrow: 1n,
    });
    expect(fillFloor.copy).toBe(belowMinimumCopy("fill-floor"));
    expect(fillFloor.recovery.id).toBe("change-tick");
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

describe("failure classification for the zero-first approve fallback", () => {
  it("does not call a rejected signature a revert", () => {
    // The fallback spends a second signature, so it must not fire on a failure
    // that says nothing about the token: answering "user declined" with another
    // wallet prompt buries the error the user needs to see.
    expect(isUserRejection(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe(true);
    expect(isRevertFailure(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe(false);
    expect(isRevertFailure(new UserRejectedRequestError(new Error("denied")))).toBe(false);
  });

  it("does not call an unreachable RPC a revert", () => {
    expect(isRevertFailure(new Error("HTTP request failed. Status: 503"))).toBe(false);
    expect(isRevertFailure(null)).toBe(false);
  });

  it("recognises a revert whether it mined or was refused before broadcast", () => {
    // A USDT-class approve usually fails at simulate/estimate, so matching only
    // the mined case would miss the path the fallback exists for.
    expect(isRevertFailure(null, true)).toBe(true);
    expect(isRevertFailure(new Error('execution reverted: The contract function "approve" reverted.'))).toBe(true);
    const reverted = Object.assign(
      Object.create(ContractFunctionRevertedError.prototype) as ContractFunctionRevertedError,
      { data: undefined, message: "" },
    );
    expect(isRevertFailure(reverted)).toBe(true);
  });
});
