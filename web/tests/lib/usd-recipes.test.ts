import { describe, expect, it } from "vitest";
import { WSTETH_ADDRESS } from "@/lib/config";
import { lookupUsdRecipe, USD_RECIPES } from "@/lib/usd-recipes";

const OTHER = "0x00000000000000000000000000000000000000aa" as const;

describe("USD recipe table", () => {
  it("ships the wstETH launch row and no other production row", () => {
    expect(USD_RECIPES).toHaveLength(1);
    expect(lookupUsdRecipe(WSTETH_ADDRESS)?.underlying).toBe(WSTETH_ADDRESS);
    expect(lookupUsdRecipe(WSTETH_ADDRESS)?.kind).toBe("chainlink-usd-times-share-rate");
    expect(lookupUsdRecipe(WSTETH_ADDRESS)?.maxSourceDeviationBps).toBe(50n);
  });

  it("fails closed for a missing underlying and does not return the wstETH row", () => {
    expect(lookupUsdRecipe(OTHER)).toBeNull();
  });
});
