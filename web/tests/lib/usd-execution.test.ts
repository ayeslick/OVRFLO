import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mulDiv, mulDivUp } from "@/lib/lending-math";
import { usd8, WAD } from "@/lib/units";
import { resolveUsdExecution } from "@/lib/usd-execution";
import { WSTETH_ADDRESS } from "@/lib/config";

const NOW = 1_700_000_000n;
const OTHER = "0x00000000000000000000000000000000000000aa" as const;
const STETH_USD_8 = 3_500_000_000n;
const STETH_PER_TOKEN = WAD + WAD / 10n;
const PRICE_Q = 3_850_000_000n;
const USD_Q = usd8(3_850_000_000n);

const wstethReads = {
  underlying: WSTETH_ADDRESS,
  round: {
    roundId: 4n,
    answer: STETH_USD_8,
    updatedAt: NOW - 10n,
    answeredInRound: 4n,
  },
  shareRate: STETH_PER_TOKEN,
  assetDecimals: 18,
  now: NOW,
};

describe("USD execution resolver", () => {
  it("looks up the recipe for the given underlying and never another column", () => {
    const ok = resolveUsdExecution(WSTETH_ADDRESS, USD_Q, wstethReads);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") throw new Error("expected ok");
    expect(ok.underlying.toLowerCase()).toBe(WSTETH_ADDRESS.toLowerCase());

    expect(resolveUsdExecution(OTHER, USD_Q, { ...wstethReads, underlying: OTHER })).toEqual({
      status: "blocked",
      reason: "missing-recipe",
    });
    expect(resolveUsdExecution(WSTETH_ADDRESS, USD_Q, { ...wstethReads, underlying: OTHER })).toEqual({
      status: "blocked",
      reason: "missing-recipe",
    });
  });

  it("blocks stale, incomplete, and non-18-decimal rounds", () => {
    expect(
      resolveUsdExecution(WSTETH_ADDRESS, USD_Q, {
        ...wstethReads,
        round: { ...wstethReads.round, updatedAt: NOW - 3_601n },
      }),
    ).toEqual({ status: "blocked", reason: "stale" });

    expect(
      resolveUsdExecution(WSTETH_ADDRESS, USD_Q, {
        ...wstethReads,
        round: { ...wstethReads.round, answeredInRound: 3n },
      }),
    ).toEqual({ status: "blocked", reason: "incomplete" });

    expect(
      resolveUsdExecution(WSTETH_ADDRESS, USD_Q, { ...wstethReads, assetDecimals: 6 }),
    ).toEqual({ status: "blocked", reason: "decimals" });
  });

  it("applies the 50 bps enclosing interval with integer mulDiv", () => {
    const ok = resolveUsdExecution(WSTETH_ADDRESS, USD_Q, wstethReads);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") throw new Error("expected ok");
    const priceLow = mulDiv(PRICE_Q, 9_950n, 10_000n);
    const priceHigh = mulDiv(PRICE_Q, 10_050n, 10_000n);
    const scale = 10n ** 18n;
    expect(ok.priceQ).toBe(PRICE_Q);
    expect(ok.priceLowQ).toBe(priceLow);
    expect(ok.priceHighQ).toBe(priceHigh);
    expect(ok.tokenNativeMin).toBe(mulDiv(USD_Q, scale, priceHigh));
    expect(ok.tokenNativeMax).toBe(mulDivUp(USD_Q, scale, priceLow));
    expect(ok.tokenNativeMin <= ok.tokenNativeMax).toBe(true);
  });

  it("never imports useUsdPrice", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/usd-execution.ts"), "utf8");
    expect(source).not.toMatch(/^import .*useUsdPrice/m);
  });
});
