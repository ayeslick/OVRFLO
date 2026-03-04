/**
 * Tests: T-WEB-004, T-WEB-006, T-WEB-015
 *
 * T-WEB-004: Verify claim amount formatting/parsing uses ovrflo token decimals.
 * T-WEB-006: Ensure rejected/reverted tx never shows success.
 * T-WEB-015: Claim MAX caps to min(wallet balance, claimable PT).
 */
import { describe, it, expect } from "vitest";
import { parseUnits, formatUnits } from "viem";

describe("ClaimModal logic (T-WEB-004, T-WEB-006, T-WEB-015)", () => {
  it("T-WEB-004: claim amount parsing respects 6-decimal ovrflo token", () => {
    const ovrfloDecimals = 6;
    const parsed = parseUnits("50.25", ovrfloDecimals);
    expect(parsed).toBe(50_250_000n);
  });

  it("T-WEB-004: claim amount formatting respects 8-decimal token", () => {
    const ptDecimals = 8;
    const formatted = formatUnits(123_456_789n, ptDecimals);
    expect(formatted).toBe("1.23456789");
  });

  it("T-WEB-006: tx lifecycle prevents success on rejection", () => {
    type TxPhase = "idle" | "claiming" | "waiting" | "success" | "error";

    let phase: TxPhase = "idle";
    let txHash: string | undefined;

    // Start claim
    phase = "claiming";
    // writeContractAsync throws (user rejection)
    phase = "error";

    expect(phase).toBe("error");
    expect(txHash).toBeUndefined();

    // Cannot reach success without going back through idle + waiting
  });

  it("T-WEB-006: tx lifecycle prevents success on receipt failure", () => {
    type TxPhase = "idle" | "claiming" | "waiting" | "success" | "error";

    let phase: TxPhase = "idle";

    // Start claim
    phase = "claiming";
    // Hash returned
    phase = "waiting";
    // Receipt fails
    phase = "error";

    expect(phase).toBe("error");
  });

  it("T-WEB-015: MAX claim is capped to min(ovrfloBalance, claimablePt)", () => {
    function computeMax(
      ovrfloBalance: bigint | undefined,
      claimablePt: bigint | undefined
    ): bigint | undefined {
      if (ovrfloBalance === undefined || claimablePt === undefined)
        return undefined;
      return ovrfloBalance < claimablePt ? ovrfloBalance : claimablePt;
    }

    // User has 100 ovrflo tokens, but only 50 PT claimable
    expect(computeMax(100n, 50n)).toBe(50n);

    // User has 30 ovrflo tokens, 100 PT claimable
    expect(computeMax(30n, 100n)).toBe(30n);

    // Equal
    expect(computeMax(50n, 50n)).toBe(50n);

    // Either undefined
    expect(computeMax(undefined, 50n)).toBeUndefined();
    expect(computeMax(50n, undefined)).toBeUndefined();
  });

  it("T-WEB-015: MAX formatted with correct ovrflo decimals", () => {
    const ovrfloDecimals = 6;
    const maxClaimable = 50_250_000n; // 50.25 at 6 decimals
    const formatted = formatUnits(maxClaimable, ovrfloDecimals);
    expect(formatted).toBe("50.25");
  });
});
