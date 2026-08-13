import { describe, expect, it } from "vitest";
import {
  alignSupplyAmount,
  bestDepthTick,
  poolAvailableWei,
  shapeLadder,
  tickInBounds,
  tickWindow,
  type TickDepthInput,
} from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, UNIT } from "@/lib/lending-math";

const rung = (aprBps: number, availableWei: bigint): TickDepthInput => ({
  aprBps,
  availableUnits: availableWei / UNIT,
});

describe("ladder window", () => {
  it("centers the three-tick window on best depth", () => {
    const model = shapeLadder([
      rung(800, 1n * 10n ** 18n),
      rung(900, 5n * 10n ** 18n),
      rung(1000, 2n * 10n ** 18n),
      rung(1100, 1n * 10n ** 18n),
      rung(1200, 1n * 10n ** 18n),
    ]);
    expect(bestDepthTick(model)).toBe(900);
    const window = tickWindow(model, null, { aprMin: 800, aprMax: 1200 });
    expect(window.selected).toBe(900);
    expect(window.rungs.map((row) => row.aprBps)).toEqual([800, 900, 1000]);
    expect(window.neighborAbove?.aprBps).toBe(1100);
  });

  it("handles exactly one live tick", () => {
    const model = shapeLadder([
      rung(900, 0n),
      rung(1000, 3n * 10n ** 18n),
      rung(1100, 0n),
    ]);
    expect(model.pickable).toHaveLength(1);
    const window = tickWindow(model, 1000, { aprMin: 900, aprMax: 1100 });
    expect(window.selected).toBe(1000);
    expect(window.rungs).toHaveLength(3);
  });

  it("disables paddles at aprMin / aprMax and never wraps", () => {
    const model = shapeLadder([
      rung(1000, 2n * 10n ** 18n),
      rung(1100, 2n * 10n ** 18n),
      rung(1200, 2n * 10n ** 18n),
    ]);
    const atMin = tickWindow(model, 1000, { aprMin: 1000, aprMax: 1200 });
    expect(atMin.prev).toBe("disabled-min");
    expect(atMin.next).toBe("enabled");
    const atMax = tickWindow(model, 1200, { aprMin: 1000, aprMax: 1200 });
    expect(atMax.prev).toBe("enabled");
    expect(atMax.next).toBe("disabled-max");
  });

  it("marks 0 < depth < MIN_LIQUIDITY_AMOUNT inert and caps pool available", () => {
    const dust = MIN_LIQUIDITY_AMOUNT - UNIT;
    const model = shapeLadder([rung(1000, dust), rung(1100, MIN_LIQUIDITY_AMOUNT)]);
    expect(model.rungs[0]?.kind).toBe("below-minimum");
    expect(model.rungs[1]?.kind).toBe("pickable");
    expect(poolAvailableWei(model.rungs[0] ?? null)).toBe(0n);
    expect(poolAvailableWei(model.rungs[1] ?? null)).toBe(MIN_LIQUIDITY_AMOUNT);
  });

  it("returns an empty-ladder window when tickDepths is zero-rung", () => {
    const model = shapeLadder([]);
    expect(model.emptyLadder).toBe(true);
    const window = tickWindow(model, null, { aprMin: 1000, aprMax: 1000 });
    expect(window.emptyLadder).toBe(true);
    expect(window.rungs).toEqual([]);
    expect(window.prev).toBe("disabled-min");
    expect(window.next).toBe("disabled-max");
  });

  it("floors odd-wei inputs to UNIT", () => {
    expect(alignSupplyAmount(1_000_000_000_000_001n)).toBe(1_000_000_000_000_000n);
    expect(alignSupplyAmount(UNIT)).toBe(UNIT);
  });

  it("derives matchability from bounds and spacing independently of ladder membership", () => {
    expect(tickInBounds(1000, { aprMin: 900, aprMax: 1100, spacing: 100 })).toBe(true);
    expect(tickInBounds(950, { aprMin: 900, aprMax: 1100, spacing: 100 })).toBe(false);
    expect(tickInBounds(800, { aprMin: 900, aprMax: 1100, spacing: 100 })).toBe(false);
  });
});
