import { describe, expect, it } from "vitest";
import { MIN_LIQUIDITY_AMOUNT, UNIT } from "@/lib/lending-math";
import { parseDecimalInput } from "@/lib/parse";
import {
  amountFieldError,
  classifySupplyError,
  queueFractions,
  shownTraceLabels,
  supplyDrift,
  supplyTrace,
  tickNoLongerValid,
  weiToAmountInput,
} from "@/components/supply/helpers";

describe("supply helpers", () => {
  it("treats exact MIN_LIQUIDITY_AMOUNT as valid", () => {
    const raw = weiToAmountInput(MIN_LIQUIDITY_AMOUNT);
    const parsed = parseDecimalInput(raw);
    expect(amountFieldError(raw, parsed, MIN_LIQUIDITY_AMOUNT * 2n)).toBeUndefined();
  });

  it("splits the queue into ahead and this order without Number(wei)", () => {
    const { ahead, self } = queueFractions(3n * 10n ** 18n, 1n * 10n ** 18n);
    expect(ahead).toBe(0.75);
    expect(self).toBe(0.25);
  });

  it("detects tick-config drift without retargeting", () => {
    expect(tickNoLongerValid(500, { aprMinBps: 400, aprMaxBps: 800, spacing: 100 })).toBe(false);
    expect(tickNoLongerValid(500, { aprMinBps: 600, aprMaxBps: 800, spacing: 100 })).toBe(true);
    expect(
      supplyDrift(
        { amount: 1n, aprBps: 500, ahead: 0n, aprMinBps: 400, aprMaxBps: 800, spacing: 100 },
        { amount: 1n, aprBps: 500, ahead: 2n, aprMinBps: 400, aprMaxBps: 800, spacing: 100 },
      ),
    ).toBe(true);
  });

  it("classifies InvalidTick as stale so the flow returns to rate select", () => {
    expect(classifySupplyError(new Error("InvalidTick()"))).toBe("stale");
  });

  it("omits APPROVE when allowance already covers", () => {
    expect(
      shownTraceLabels(
        supplyTrace({
          underlyingSymbol: "wstETH",
          needsApprove: false,
          ackRequired: false,
          checkpoint: "sign",
        }),
      ),
    ).toEqual(["AMOUNT", "APR", "SUPPLY", "SETTLED"]);
  });

  it("rejects an unaligned amount against UNIT", () => {
    const parsed = { ok: true as const, value: MIN_LIQUIDITY_AMOUNT + 1n };
    expect(amountFieldError("dust", parsed, 10n ** 18n, MIN_LIQUIDITY_AMOUNT, UNIT, "wstETH")).toMatch(/UNIT/);
  });
});
