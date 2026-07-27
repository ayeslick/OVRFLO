import { describe, expect, it } from "vitest";
import { parseUnits, type Address } from "viem";
import { formatAddress, formatAprBps, formatId, formatMaturity, formatTokenAmount } from "@/lib/format";
import { formatBpsPct } from "@/lib/lending-math";

describe("formatTokenAmount", () => {
  it("carries fractional rounding into the whole amount", () => {
    expect(formatTokenAmount(parseUnits("1.995", 18), "wstETH")).toBe("2.00 wstETH");
  });

  it("renders a dash placeholder when the value is undefined", () => {
    expect(formatTokenAmount(undefined, "wstETH")).toBe("— wstETH");
  });

  it("shows two decimals for whole amounts and four for sub-1 values", () => {
    expect(formatTokenAmount(parseUnits("120.5", 18), "ovrflo")).toBe("120.50 ovrflo");
    expect(formatTokenAmount(parseUnits("0.1234", 18), "ovrflo")).toBe("0.1234 ovrflo");
    expect(formatTokenAmount(0n, "ovrflo")).toBe("0.00 ovrflo");
  });

  it("honours non-18 decimal scales", () => {
    expect(formatTokenAmount(parseUnits("2.5", 6), "usdc", 6)).toBe("2.50 usdc");
  });

  it("keeps 4 decimals when rounding a sub-1 value carries into a whole number", () => {
    // 0.999999999999999999 rounds to 1 at 4 decimals, but the decimal COUNT was
    // already locked to 4 by the pre-rounding whole===0n check, so the display
    // is "1.0000", not "1.00" — a real edge case, not just a rounding nicety.
    expect(formatTokenAmount(999_999_999_999_999_999n, "wstETH")).toBe("1.0000 wstETH");
  });
});

describe("formatAprBps", () => {
  it("renders bps as a two-decimal percent from bigint or number", () => {
    expect(formatAprBps(462n)).toBe("4.62%");
    expect(formatAprBps(1000)).toBe("10.00%");
    expect(formatAprBps(5n)).toBe("0.05%");
  });
});

describe("formatBpsPct", () => {
  it("renders upfront/return percentages with exactly one truncated decimal", () => {
    expect(formatBpsPct(9523n)).toBe("95.2%");
    expect(formatBpsPct(9529n)).toBe("95.2%");
    expect(formatBpsPct(500n)).toBe("5.0%");
  });
});

describe("formatAddress", () => {
  it("truncates the middle and dashes empty input", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(formatAddress(null)).toBe("—");
  });

  it("dashes an empty-string address the same as null/undefined", () => {
    expect(formatAddress("" as Address)).toBe("—");
    expect(formatAddress(undefined)).toBe("—");
  });
});

describe("formatMaturity / formatId", () => {
  it("formats a UTC maturity date and handles unknowns", () => {
    expect(formatMaturity(1782345600n)).toBe("Jun 25, 2026");
    expect(formatMaturity(undefined)).toBe("Maturity unknown");
  });

  it("treats a zero timestamp as unknown (the epoch is never a real maturity)", () => {
    expect(formatMaturity(0n)).toBe("Maturity unknown");
  });

  it("prefixes ids with a hash or dashes unknowns", () => {
    expect(formatId(7n)).toBe("#7");
    expect(formatId(undefined)).toBe("—");
  });

  it("prefixes id 0 with a hash rather than treating it as unknown (0n is falsy but valid)", () => {
    expect(formatId(0n)).toBe("#0");
  });
});
