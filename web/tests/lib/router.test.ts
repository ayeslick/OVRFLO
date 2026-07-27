import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { LiquidityPosition } from "@/lib/types";
import { buildLadder, planBorrow } from "@/lib/router";

const market = "0x00000000000000000000000000000000000000aa" as Address;
const otherMarket = "0x00000000000000000000000000000000000000bb" as Address;
const lenderA = "0x0000000000000000000000000000000000000a11" as Address;
const self = "0x0000000000000000000000000000000000005e1f" as Address;

function pos(id: bigint, aprBps: number, availableLiquidity: bigint, lender: Address = lenderA): LiquidityPosition {
  return { id, lender, market, aprBps, availableLiquidity };
}

describe("buildLadder", () => {
  it("groups per tick, excludes self from total, counts self in own, keeps all positions", () => {
    const ladder = buildLadder(
      [pos(1n, 1000, 100n), pos(2n, 1000, 50n, self), pos(3n, 1100, 70n)],
      market,
      [1000, 1100],
      self,
    );
    expect(ladder).toHaveLength(2);
    expect(ladder[0]).toMatchObject({ aprBps: 1000, total: 100n, own: 50n });
    expect(ladder[0].positions.map((p) => p.id)).toEqual([1n, 2n]);
    expect(ladder[1]).toMatchObject({ aprBps: 1100, total: 70n, own: 0n });
  });

  it("filters other markets and zero-liquidity positions", () => {
    const ladder = buildLadder(
      [
        pos(1n, 1000, 100n),
        { id: 2n, lender: lenderA, market: otherMarket, aprBps: 1000, availableLiquidity: 40n },
        pos(3n, 1000, 0n),
      ],
      market,
      [1000],
    );
    expect(ladder[0].total).toBe(100n);
    expect(ladder[0].positions.map((p) => p.id)).toEqual([1n]);
  });

  it("sorts positions ascending by id even when the input is descending", () => {
    const ladder = buildLadder([pos(9n, 1000, 10n), pos(4n, 1000, 10n), pos(2n, 1000, 10n)], market, [1000]);
    expect(ladder[0].positions.map((p) => p.id)).toEqual([2n, 4n, 9n]);
  });

  it("matches self and market case-insensitively", () => {
    const ladder = buildLadder(
      [{ id: 1n, lender: self.toUpperCase().replace("0X", "0x") as Address, market, aprBps: 1000, availableLiquidity: 5n }],
      market.toUpperCase().replace("0X", "0x") as Address,
      [1000],
      self,
    );
    expect(ladder[0].own).toBe(5n);
    expect(ladder[0].total).toBe(0n);
  });
});

describe("planBorrow", () => {
  it("prefers a single covering position over accumulating, even when smaller ids exist", () => {
    const ladder = buildLadder([pos(1n, 1000, 40n), pos(2n, 1000, 40n), pos(3n, 1000, 100n)], market, [1000]);
    const { primary, alternative } = planBorrow(ladder, 80n, undefined);
    expect(primary).toEqual({ kind: "full", aprBps: 1000, ids: [3n] });
    expect(alternative).toBeNull();
  });

  it("FIFO-accumulates ascending ids when no single position covers", () => {
    const ladder = buildLadder([pos(1n, 1000, 40n), pos(2n, 1000, 40n), pos(3n, 1000, 40n)], market, [1000]);
    const { primary } = planBorrow(ladder, 70n, undefined);
    expect(primary).toEqual({ kind: "full", aprBps: 1000, ids: [1n, 2n] });
  });

  it("reports full at a deeper tick plus a partial alternative at the lower tick", () => {
    const ladder = buildLadder([pos(1n, 1000, 30n), pos(2n, 1100, 100n)], market, [1000, 1100]);
    const { primary, alternative } = planBorrow(ladder, 80n, undefined);
    expect(primary).toEqual({ kind: "full", aprBps: 1100, ids: [2n] });
    expect(alternative).toEqual({ kind: "partial", aprBps: 1000, ids: [1n], available: 30n });
  });

  it("reports partial only when nothing covers anywhere", () => {
    const ladder = buildLadder([pos(1n, 1000, 30n), pos(2n, 1100, 20n)], market, [1000, 1100]);
    const { primary, alternative } = planBorrow(ladder, 80n, undefined);
    expect(primary).toEqual({ kind: "partial", aprBps: 1000, ids: [1n], available: 30n });
    expect(alternative).toBeNull();
  });

  it("never draws against self-owned liquidity", () => {
    const ladder = buildLadder(
      [pos(1n, 1000, 100n, self), pos(2n, 1000, 30n)],
      market,
      [1000],
      self,
    );
    const { primary, alternative } = planBorrow(ladder, 80n, self);
    expect(primary).toEqual({ kind: "partial", aprBps: 1000, ids: [2n], available: 30n });
    expect(alternative).toBeNull();
  });

  it("emits strictly increasing ids from descending input", () => {
    const ladder = buildLadder([pos(9n, 1000, 40n), pos(5n, 1000, 40n), pos(3n, 1000, 40n)], market, [1000]);
    const { primary } = planBorrow(ladder, 100n, undefined);
    expect(primary.kind).toBe("full");
    if (primary.kind === "full") {
      expect(primary.ids).toEqual([3n, 5n, 9n]);
      const sorted = [...primary.ids].sort((a, b) => (a < b ? -1 : 1));
      expect(primary.ids).toEqual(sorted);
    }
  });

  it("returns empty when no tick has liquidity", () => {
    const { primary, alternative } = planBorrow(buildLadder([], market, [1000, 1100]), 10n, undefined);
    expect(primary).toEqual({ kind: "empty" });
    expect(alternative).toBeNull();
  });
});
