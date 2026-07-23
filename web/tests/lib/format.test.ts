import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { formatTokenAmount } from "@/lib/format";

describe("formatTokenAmount", () => {
  it("carries fractional rounding into the whole amount", () => {
    expect(formatTokenAmount(parseUnits("1.995", 18), "wstETH")).toBe("2.00 wstETH");
  });
});
