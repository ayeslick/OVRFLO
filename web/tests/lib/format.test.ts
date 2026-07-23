import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { formatAddress, formatAprBps, formatId, formatMaturity, formatTokenAmount } from "@/lib/format";

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
});

describe("formatAprBps", () => {
  it("renders bps as a two-decimal percent from bigint or number", () => {
    expect(formatAprBps(462n)).toBe("4.62%");
    expect(formatAprBps(1000)).toBe("10.00%");
    expect(formatAprBps(5n)).toBe("0.05%");
  });
});

describe("formatAddress", () => {
  it("truncates the middle and dashes empty input", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(formatAddress(null)).toBe("—");
  });
});

describe("formatMaturity / formatId", () => {
  it("formats a UTC maturity date and handles unknowns", () => {
    expect(formatMaturity(1782345600n)).toBe("Jun 25, 2026");
    expect(formatMaturity(undefined)).toBe("Maturity unknown");
  });

  it("prefixes ids with a hash or dashes unknowns", () => {
    expect(formatId(7n)).toBe("#7");
    expect(formatId(undefined)).toBe("—");
  });
});
