import { describe, expect, it } from "vitest";
import {
  add,
  bps,
  formatUnits,
  max,
  min,
  mulDiv,
  mulDivUp,
  ovrfloWei,
  parseUnits,
  sub,
  toDisplayMagnitude,
  wei,
  wstethWei,
  usd8,
  WAD,
} from "@/lib/units";

describe("units constructors", () => {
  it("rejects negative values", () => {
    expect(() => wei(-1n)).toThrow(/negative/);
    expect(() => wstethWei(-1n)).toThrow(/negative/);
    expect(() => usd8(-1n)).toThrow(/negative/);
    expect(() => bps(-1n)).toThrow(/negative/);
  });

  it("mints matching brands for zero and dust", () => {
    expect(wei(0n)).toBe(0n);
    expect(wstethWei(1n)).toBe(1n);
    expect(ovrfloWei(WAD)).toBe(WAD);
  });
});

describe("units arithmetic", () => {
  it("adds, subtracts, and orders matching brands", () => {
    const a = wstethWei(10n);
    const b = wstethWei(3n);
    expect(add(a, b)).toBe(13n);
    expect(sub(a, b)).toBe(7n);
    expect(min(a, b)).toBe(3n);
    expect(max(a, b)).toBe(10n);
  });

  it("refuses underflow", () => {
    expect(() => sub(wstethWei(1n), wstethWei(2n))).toThrow(/underflow/);
  });

  it("keeps ratio math exact across Number.MAX_SAFE_INTEGER", () => {
    const above = 2n ** 53n + 11n;
    const den = 2n ** 53n + 3n;
    const branded = wei(above);
    expect(Number(above) === Number(above + 1n)).toBe(true);
    expect(mulDiv(branded, 10_000n, den)).toBe((above * 10_000n) / den);
    expect(mulDivUp(branded, 10_000n, den)).toBe((above * 10_000n + den - 1n) / den);
  });

  it("scales to display magnitude before any number conversion", () => {
    const amount = wei(1_995_000_000_000_000_000n);
    const scaled = toDisplayMagnitude(amount, 10n ** 16n);
    expect(scaled).toBe(199n);
    expect(Number(scaled)).toBe(199);
  });
});

describe("formatUnits / parseUnits round-trip", () => {
  it("round-trips 18 decimals with dust and max-uint values", () => {
    const dust = parseUnits("0.000000000000000001", 18);
    expect(formatUnits(dust, 18)).toBe("0.000000000000000001");
    expect(parseUnits(formatUnits(dust, 18), 18)).toBe(dust);

    const whole = parseUnits("123.45", 18);
    expect(formatUnits(whole, 18)).toBe("123.450000000000000000");
    expect(parseUnits("123.450000000000000000", 18)).toBe(whole);

    const max = wei((1n << 256n) - 1n);
    const formatted = formatUnits(max, 18);
    expect(parseUnits(formatted, 18)).toBe(max);
  });
});
