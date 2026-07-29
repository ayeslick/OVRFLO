import { describe, expect, it } from "vitest";
import { parseUnits, type Address } from "viem";
import {
  formatAddress,
  formatAprBps,
  formatCountdown,
  formatId,
  formatMaturity,
  formatMaturityDate,
  formatMaturityId,
  formatTokenAmount,
} from "@/lib/format";
import { formatBpsPct } from "@/lib/lending-math";

describe("formatTokenAmount", () => {
  it("floors rather than rounding up, so a balance is never overstated (R21/M-14)", () => {
    // Was "2.00" under round-half-up. Displaying more than the user holds
    // invites them to spend a unit they do not have and eat the revert.
    expect(formatTokenAmount(parseUnits("1.995", 18), "wstETH")).toBe("1.99 wstETH");
    expect(formatTokenAmount(parseUnits("0.99999", 18), "wstETH")).toBe("0.9999 wstETH");
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

  it("never lets a sub-1 value display as a whole unit", () => {
    // Under round-half-up this read "1.0000" — a balance one wei short of 1
    // presented as a full unit, which is the exact overstatement M-14 names.
    expect(formatTokenAmount(999_999_999_999_999_999n, "wstETH")).toBe("0.9999 wstETH");
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
  it("formats the caption form with its verb, per DESIGN.md §10 (L-10)", () => {
    expect(formatMaturity(1782345600n)).toBe("Matures Jun 25, 2026");
    expect(formatMaturity(undefined)).toBe("Maturity unknown");
  });

  it("formats the bare date for callers supplying their own prose", () => {
    expect(formatMaturityDate(1782345600n)).toBe("Jun 25, 2026");
  });

  it("formats the compact identifier form (L-10)", () => {
    expect(formatMaturityId(1782345600n)).toBe("25JUN26");
    expect(formatMaturityId(undefined)).toBe("—");
  });

  it("formats the countdown with hours, flooring both parts (L-10)", () => {
    // Days alone hid up to 23 hours of remaining term.
    expect(formatCountdown(142n * 86_400n + 6n * 3_600n + 59n)).toBe("142d 06h");
    expect(formatCountdown(0n)).toBe("0d 00h");
    expect(formatCountdown(-5n)).toBe("0d 00h");
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
