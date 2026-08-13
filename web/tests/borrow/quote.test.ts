import { describe, expect, it } from "vitest";
import { shapeLadder } from "@/lib/ladder";
import {
  BPS,
  MIN_LIQUIDITY_AMOUNT,
  UNIT,
  YEAR_SECONDS,
  floorToUnit,
  grossPrice,
} from "@/lib/lending-math";
import { applySlippageDown } from "@/lib/modal-logic";
import {
  liveTickCopy,
  poolFractions,
  quoteBorrow,
  quoteDrift,
  snapshotQuote,
  streamDerivedCap,
  tickDepthWei,
  weiToAmountInput,
} from "@/components/borrow/quote";

const ETHER = 10n ** 18n;
const REMAINING = 110n * ETHER;
const APR = 1000;
const TTM = YEAR_SECONDS;
const FEE = 40;

describe("borrow quote", () => {
  it("MAX cap is UNIT-floored grossPrice, not a wallet balance", () => {
    const gross = grossPrice(REMAINING, APR, TTM);
    const cap = streamDerivedCap(REMAINING, APR, TTM);
    expect(cap).toBe(floorToUnit(gross));
    expect(cap % UNIT).toBe(0n);
    expect(cap < gross || cap === gross).toBe(true);
  });

  it("states sale equivalence only when obligation equals remaining", () => {
    const remaining = 123_456_789_012_345_678_901n;
    const exact = quoteBorrow({
      remaining,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: grossPrice(remaining, APR, TTM),
      depth: 10n ** 30n,
      unit: 1n,
    });
    expect(exact.saleEquivalent).toBe(true);
    expect(exact.obligation).toBe(remaining);
    expect(exact.residual).toBe(0n);

    const clamped = quoteBorrow({
      remaining,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: streamDerivedCap(remaining, APR, TTM),
      depth: 10n ** 30n,
    });
    expect(clamped.fill).toBe(streamDerivedCap(remaining, APR, TTM));
    expect(clamped.fill < grossPrice(remaining, APR, TTM)).toBe(true);
    expect(clamped.saleEquivalent).toBe(false);
    expect(clamped.residual).toBeGreaterThan(0n);
  });

  it("derives minAcceptable from reviewed net", () => {
    const quote = quoteBorrow({
      remaining: REMAINING,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: 10n * ETHER,
      depth: 50n * ETHER,
    });
    expect(quote.minAcceptable).toBe(applySlippageDown(quote.net));
    expect(quote.minAcceptable <= quote.net).toBe(true);
    expect(quote.feeAmount).toBe((quote.fill * BigInt(FEE)) / BPS);
  });

  it("flags a partial fill when draw exceeds depth", () => {
    const quote = quoteBorrow({
      remaining: REMAINING,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: 20n * ETHER,
      depth: 5n * ETHER,
    });
    expect(quote.partial).toBe(true);
    expect(quote.fill).toBe(floorToUnit(5n * ETHER));
    expect(quote.emptyTick).toBe(false);
  });

  it("marks an empty tick below the fill floor", () => {
    const quote = quoteBorrow({
      remaining: REMAINING,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: 5n * ETHER,
      depth: MIN_LIQUIDITY_AMOUNT - 1n,
    });
    expect(quote.emptyTick).toBe(true);
    expect(quote.partial).toBe(false);
  });

  it("detects quote drift on gross, fee, net, or depth", () => {
    const live = quoteBorrow({
      remaining: REMAINING,
      aprBps: APR,
      ttmSeconds: TTM,
      feeBps: FEE,
      target: 10n * ETHER,
      depth: 50n * ETHER,
    });
    const frozen = snapshotQuote(live, APR);
    expect(quoteDrift(frozen, live)).toBe(false);
    expect(quoteDrift(frozen, { ...live, net: live.net - 1n })).toBe(true);
    expect(quoteDrift(frozen, { ...live, depth: live.depth - UNIT })).toBe(true);
  });

  it("round-trips MAX through the amount input", () => {
    const cap = streamDerivedCap(REMAINING, APR, TTM);
    const raw = weiToAmountInput(cap);
    expect(raw.includes(".") ? raw.split(".")[1]?.length ?? 0 : 0).toBeLessThanOrEqual(18);
    const [whole, frac = ""] = raw.split(".");
    const back = BigInt(whole ?? "0") * ETHER + BigInt(frac.padEnd(18, "0"));
    expect(back).toBe(cap);
  });

  it("names live ticks and reports pool overrun with bigint-safe fractions", () => {
    const model = shapeLadder([
      { aprBps: 1000, availableUnits: 0n },
      { aprBps: 1100, availableUnits: 5_000_000n },
    ]);
    expect(liveTickCopy(model)).toContain("11.00%");
    expect(tickDepthWei(model, 1000)).toBe(0n);
    expect(poolFractions(12n, 10n).overrun).toBe(true);
    expect(poolFractions(4n, 10n).self).toBe(0.4);
  });
});
