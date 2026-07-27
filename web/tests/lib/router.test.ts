import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { LiquidityPosition } from "@/lib/types";
import { buildLadder } from "@/lib/router";

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
