import { describe, expect, it } from "vitest";
import {
  CYCLE_STEPS,
  TEACHING_SENTENCES,
  cycleHaveLabel,
  ovrfloMintCopy,
} from "@/components/first-run/cycleCopy";

describe("first-run cycle copy", () => {
  it("uses market-driven mint copy until a live symbol exists", () => {
    expect(ovrfloMintCopy(null)).toBe("mints the market's ovrflo token");
    expect(ovrfloMintCopy("")).toBe("mints the market's ovrflo token");
    expect(ovrfloMintCopy("ovrfloWSTETH")).toBe("mints ovrfloWSTETH");
  });

  it("does not hardcode a token symbol into the cycle labels", () => {
    expect(CYCLE_STEPS.map((step) => step.label)).toEqual([
      "GET PT",
      "DEPOSIT",
      "RECEIVE STREAM",
      "BORROW",
    ]);
    expect(cycleHaveLabel("deposit", null)).toBe("ovrflo token + stream");
    expect(cycleHaveLabel("deposit", "ovrfloWSTETH")).toBe("ovrfloWSTETH + stream");
  });

  it("teaches four sentences and does not promise engagement", () => {
    expect(TEACHING_SENTENCES).toHaveLength(4);
    expect(TEACHING_SENTENCES.join(" ")).not.toMatch(/don't miss|streak|daily/i);
  });
});
