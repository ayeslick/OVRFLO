import { describe, expect, it } from "vitest";
import { convertApprovalNeeds, convertValidationError, depositCapStatus } from "@/lib/convert";

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

  it("never needs underlying approval for a deposit, even when a fee is quoted", () => {
    expect(convertApprovalNeeds(base)).toMatchObject({ needsUnderlyingApproval: false });
    expect(convertApprovalNeeds({ ...base, feeAmount: 5n })).toMatchObject({ needsUnderlyingApproval: false });
    expect(
      convertApprovalNeeds({ ...base, feeAmount: 5n, underlyingAllowance: 0n, underlyingApprovedAmount: 0n }),
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

describe("wrap approval is exact and unbuffered", () => {
  const wrapBase = {
    mode: "wrap" as const,
    amount: 1000n,
    feeAmount: 0n,
    ptAllowance: 0n,
    ptApprovedAmount: 0n,
    underlyingAllowance: 0n,
    underlyingApprovedAmount: 0n,
  };

  it("gates wrap on the exact amount", () => {
    expect(convertApprovalNeeds({ ...wrapBase, underlyingApprovedAmount: 999n }).needsUnderlyingApproval).toBe(true);
    expect(convertApprovalNeeds({ ...wrapBase, underlyingApprovedAmount: 1000n }).needsUnderlyingApproval).toBe(
      false,
    );
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
