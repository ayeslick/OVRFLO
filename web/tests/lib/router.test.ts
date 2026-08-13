import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { LiquidityPosition } from "@/lib/types";
import { buildLadder, selectHydratedRoute } from "@/lib/router";

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
    expect(ladder[0]!).toMatchObject({ aprBps: 1000, total: 100n, own: 50n });
    expect(ladder[0]!.positions.map((p) => p.id)).toEqual([1n, 2n]);
    expect(ladder[1]!).toMatchObject({ aprBps: 1100, total: 70n, own: 0n });
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
    expect(ladder[0]!.total).toBe(100n);
    expect(ladder[0]!.positions.map((p) => p.id)).toEqual([1n]);
  });

  it("sorts positions ascending by id even when the input is descending", () => {
    const ladder = buildLadder([pos(9n, 1000, 10n), pos(4n, 1000, 10n), pos(2n, 1000, 10n)], market, [1000]);
    expect(ladder[0]!.positions.map((p) => p.id)).toEqual([2n, 4n, 9n]);
  });

  it("sorts tick output ascending by apr regardless of input tick order", () => {
    const ladder = buildLadder([pos(1n, 1000, 10n), pos(2n, 1100, 10n)], market, [1100, 1000]);
    expect(ladder.map((t) => t.aprBps)).toEqual([1000, 1100]);
  });

  it("returns an empty ladder for an empty ticks list", () => {
    expect(buildLadder([pos(1n, 1000, 10n)], market, [])).toEqual([]);
  });

  it("counts everything as total (never own) when no self address is connected", () => {
    // The position is lent by `self` — if buildLadder fell back to treating
    // an omitted `self` param as "matches everything" (or anything other than
    // "matches nothing"), this position would wrongly count as `own`.
    const ladder = buildLadder([pos(1n, 1000, 10n, self)], market, [1000]);
    expect(ladder[0]!).toMatchObject({ total: 10n, own: 0n });
  });

  it("matches self and market case-insensitively", () => {
    const ladder = buildLadder(
      [{ id: 1n, lender: self.toUpperCase().replace("0X", "0x") as Address, market, aprBps: 1000, availableLiquidity: 5n }],
      market.toUpperCase().replace("0X", "0x") as Address,
      [1000],
      self,
    );
    expect(ladder[0]!.own).toBe(5n);
    expect(ladder[0]!.total).toBe(0n);
  });
});

describe("selectHydratedRoute", () => {
  it("conserves the public book before applying self-exclusion", () => {
    const positions = [pos(1n, 1000, 100n, self), pos(2n, 1000, 50n)];
    expect(
      selectHydratedRoute({
        positions,
        borrower: self,
        target: 50n,
        aggregateDepth: 140n,
        maxRouteIds: 128,
      }),
    ).toMatchObject({ status: "conservation-failed", projectedDepth: 150n, aggregateDepth: 140n });
  });

  it("reports public and borrower-usable depth independently after conservation", () => {
    const positions = [pos(1n, 1000, 100n, self), pos(2n, 1000, 50n)];
    expect(
      selectHydratedRoute({
        positions,
        borrower: self,
        target: 50n,
        aggregateDepth: 150n,
        maxRouteIds: 128,
      }),
    ).toMatchObject({
      status: "ready",
      publicDepth: 150n,
      executableDepth: 50n,
      selfExcludedDepth: 100n,
      selectedIds: [2n],
    });
  });

  it("minimizes cardinality by availability and sorts only selected ids ascending", () => {
    const positions = [
      pos(30n, 1000, 20n),
      pos(9n, 1000, 70n),
      pos(2n, 1000, 40n),
      pos(15n, 1000, 90n),
    ];
    const result = selectHydratedRoute({
      positions,
      target: 150n,
      aggregateDepth: 220n,
      maxRouteIds: 128,
    });
    expect(result).toMatchObject({ status: "ready", selectedIds: [9n, 15n], selectedDepth: 160n });
  });

  it("exposes fragmented non-executable depth when the route cap is insufficient", () => {
    const dust = Array.from({ length: 500 }, (_, index) => pos(BigInt(index + 1), 1000, 1n));
    const result = selectHydratedRoute({
      positions: dust,
      target: 200n,
      aggregateDepth: 500n,
      maxRouteIds: 128,
    });
    expect(result).toMatchObject({
      status: "fragmented",
      publicDepth: 500n,
      executableDepth: 128n,
      fragmentedDepth: 372n,
    });
    if (result.status === "fragmented") expect(result.selectedIds).toHaveLength(128);
  });
});
