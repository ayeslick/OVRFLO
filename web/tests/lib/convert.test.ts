import { describe, expect, it } from "vitest";
import {
  bufferedFeeApproveAmount,
  convertApprovalNeeds,
  convertValidationError,
  depositCapStatus,
} from "@/lib/convert";

const MAX_UINT256 = (1n << 256n) - 1n;

describe("depositCapStatus", () => {
  it("treats a zero cap as unlimited", () => {
    expect(depositCapStatus({ mode: "deposit", amount: 500n, capLoaded: true, capLimit: 0n, capUsed: 100n })).toEqual(
      { capRemaining: null, capReached: false, capExceeded: false },
    );
  });

  it("reports remaining, reached, and exceeded around a positive cap", () => {
    expect(
      depositCapStatus({ mode: "deposit", amount: 50n, capLoaded: true, capLimit: 100n, capUsed: 40n }),
    ).toEqual({ capRemaining: 60n, capReached: false, capExceeded: false });

    expect(
      depositCapStatus({ mode: "deposit", amount: 10n, capLoaded: true, capLimit: 100n, capUsed: 100n }),
    ).toMatchObject({ capRemaining: 0n, capReached: true });

    expect(
      depositCapStatus({ mode: "deposit", amount: 70n, capLoaded: true, capLimit: 100n, capUsed: 40n }),
    ).toMatchObject({ capRemaining: 60n, capExceeded: true });
  });

  it("never flags reached/exceeded before the cap reads have loaded", () => {
    expect(
      depositCapStatus({ mode: "deposit", amount: 1000n, capLoaded: false, capLimit: 100n, capUsed: 100n }),
    ).toMatchObject({ capReached: false, capExceeded: false });
  });

  it("only applies cap gating to deposit mode", () => {
    expect(
      depositCapStatus({ mode: "wrap", amount: 1000n, capLoaded: true, capLimit: 100n, capUsed: 100n }),
    ).toMatchObject({ capReached: false, capExceeded: false });
  });

  it("does not flag exceeded when the amount exactly equals the remaining capacity", () => {
    expect(
      depositCapStatus({ mode: "deposit", amount: 60n, capLoaded: true, capLimit: 100n, capUsed: 40n }),
    ).toMatchObject({ capRemaining: 60n, capExceeded: false });
  });

  it("clamps remaining capacity to zero (never negative) if used already exceeds the limit", () => {
    expect(
      depositCapStatus({ mode: "deposit", amount: 1n, capLoaded: true, capLimit: 100n, capUsed: 150n }),
    ).toMatchObject({ capRemaining: 0n, capReached: true, capExceeded: false });
  });
});

describe("convertApprovalNeeds", () => {
  const base = {
    mode: "deposit" as const,
    amount: 100n,
    feeAmount: 0n,
    ptAllowance: 0n,
    ptApprovedAmount: 0n,
    underlyingAllowance: 0n,
    underlyingApprovedAmount: 0n,
  };

  it("needs PT approval when allowance and the optimistic approved amount both fall short", () => {
    expect(convertApprovalNeeds(base)).toMatchObject({ needsPtApproval: true, needsApproval: true });
    expect(convertApprovalNeeds({ ...base, ptAllowance: 100n })).toMatchObject({ needsPtApproval: false });
    expect(convertApprovalNeeds({ ...base, ptApprovedAmount: 100n })).toMatchObject({ needsPtApproval: false });
  });

  it("needs underlying approval for the fee only when a deposit fee is due", () => {
    expect(convertApprovalNeeds(base)).toMatchObject({ needsUnderlyingApproval: false });
    expect(convertApprovalNeeds({ ...base, feeAmount: 5n })).toMatchObject({ needsUnderlyingApproval: true });
    expect(
      convertApprovalNeeds({ ...base, feeAmount: 5n, underlyingAllowance: 5n }),
    ).toMatchObject({ needsUnderlyingApproval: false });
  });

  it("needs underlying approval for the full amount on wrap, ignoring feeAmount", () => {
    expect(convertApprovalNeeds({ ...base, mode: "wrap", feeAmount: 0n })).toMatchObject({
      needsUnderlyingApproval: true,
    });
    expect(
      convertApprovalNeeds({ ...base, mode: "wrap", underlyingAllowance: 100n }),
    ).toMatchObject({ needsUnderlyingApproval: false });
  });

  it("needs nothing for a zero amount", () => {
    expect(convertApprovalNeeds({ ...base, amount: 0n })).toEqual({
      needsPtApproval: false,
      needsUnderlyingApproval: false,
      needsApproval: false,
    });
  });
});

describe("bufferedFeeApproveAmount", () => {
  it("adds 2% headroom to a round fee", () => {
    expect(bufferedFeeApproveAmount(100n)).toBe(102n);
  });

  it("floors on a non-round fee rather than rounding up", () => {
    // 12345 * 102 / 100 = 12591.9 -> 12591
    expect(bufferedFeeApproveAmount(12_345n)).toBe(12_591n);
  });

  it("buffers a realistic wad-scale fee", () => {
    const fee = 25n * 10n ** 16n; // 0.25e18
    expect(bufferedFeeApproveAmount(fee)).toBe(255n * 10n ** 15n); // 0.255e18
  });

  it("stays zero for a zero fee, so the approve branch is never armed by the buffer", () => {
    expect(bufferedFeeApproveAmount(0n)).toBe(0n);
  });

  it("cannot produce headroom for a 1 wei fee (integer floor), which is acceptable", () => {
    expect(bufferedFeeApproveAmount(1n)).toBe(1n);
  });

  it("never returns an unlimited approval (R10)", () => {
    for (const fee of [0n, 1n, 100n, 10n ** 18n, 10n ** 24n]) {
      const buffered = bufferedFeeApproveAmount(fee);
      expect(buffered).not.toBe(MAX_UINT256);
      expect(buffered).toBeLessThan(fee + fee / 10n + 10n);
    }
  });
});

describe("deposit fee approve buffer end to end (R7/R8)", () => {
  const base = {
    mode: "deposit" as const,
    amount: 1000n,
    ptAllowance: 0n,
    ptApprovedAmount: 1000n,
    underlyingAllowance: 0n,
  };

  it("advances to DEPOSIT when the requoted fee stays inside the buffer", () => {
    const quotedFee = 1000n;
    const approved = bufferedFeeApproveAmount(quotedFee); // 1020
    const requotedFee = 1010n; // +1%, inside the buffer

    expect(
      convertApprovalNeeds({ ...base, feeAmount: requotedFee, underlyingApprovedAmount: approved })
        .needsUnderlyingApproval,
    ).toBe(false);
  });

  it("re-prompts approve when the requoted fee exceeds the buffer", () => {
    const quotedFee = 1000n;
    const approved = bufferedFeeApproveAmount(quotedFee); // 1020
    const requotedFee = 1030n; // +3%, beyond the buffer

    expect(
      convertApprovalNeeds({ ...base, feeAmount: requotedFee, underlyingApprovedAmount: approved })
        .needsUnderlyingApproval,
    ).toBe(true);
  });

  it("would have re-prompted at the same drift without the buffer", () => {
    // Characterizes the bug the buffer closes: an exact-fee approve is stranded
    // by any upward requote at all.
    const quotedFee = 1000n;
    expect(
      convertApprovalNeeds({ ...base, feeAmount: 1001n, underlyingApprovedAmount: quotedFee })
        .needsUnderlyingApproval,
    ).toBe(true);
  });

  it("covers the drift through on-chain allowance too, not just the optimistic amount", () => {
    expect(
      convertApprovalNeeds({
        ...base,
        feeAmount: 1010n,
        underlyingAllowance: bufferedFeeApproveAmount(1000n),
        underlyingApprovedAmount: 0n,
      }).needsUnderlyingApproval,
    ).toBe(false);
  });

  it("leaves a zero-fee deposit with no underlying approval need", () => {
    expect(
      convertApprovalNeeds({ ...base, feeAmount: 0n, underlyingApprovedAmount: 0n }).needsUnderlyingApproval,
    ).toBe(false);
  });

  it("wrap still gates on the exact amount, unbuffered (R9)", () => {
    expect(
      convertApprovalNeeds({
        ...base,
        mode: "wrap",
        feeAmount: 0n,
        underlyingApprovedAmount: 999n,
      }).needsUnderlyingApproval,
    ).toBe(true);

    expect(
      convertApprovalNeeds({
        ...base,
        mode: "wrap",
        feeAmount: 0n,
        underlyingApprovedAmount: 1000n,
      }).needsUnderlyingApproval,
    ).toBe(false);
  });
});

describe("convertValidationError", () => {
  it("flags insufficient balance before checking the cap", () => {
    expect(
      convertValidationError({ amount: 100n, walletBalance: 50n, capExceeded: true, capRemaining: 10n }),
    ).toBe("INSUFFICIENT BALANCE");
  });

  it("flags an exceeded cap with the remaining amount in the message", () => {
    expect(
      convertValidationError({
        amount: 100n * 10n ** 18n,
        walletBalance: 500n * 10n ** 18n,
        capExceeded: true,
        capRemaining: 60n * 10n ** 18n,
      }),
    ).toContain("60.00");
  });

  it("returns null when neither condition holds", () => {
    expect(
      convertValidationError({ amount: 100n, walletBalance: 500n, capExceeded: false, capRemaining: null }),
    ).toBeNull();
  });

  it("returns null for a zero amount even with insufficient balance", () => {
    expect(
      convertValidationError({ amount: 0n, walletBalance: 0n, capExceeded: false, capRemaining: null }),
    ).toBeNull();
  });

  it("does not flag insufficient balance when the amount exactly equals the wallet balance", () => {
    expect(
      convertValidationError({ amount: 500n, walletBalance: 500n, capExceeded: false, capRemaining: null }),
    ).toBeNull();
  });
});
