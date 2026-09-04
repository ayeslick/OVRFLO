import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { LiquidityPosition } from "@/lib/types";
import { selectHydratedRoute } from "@/lib/router";

const market = "0x00000000000000000000000000000000000000aa" as Address;
const lenderA = "0x0000000000000000000000000000000000000a11" as Address;
const self = "0x0000000000000000000000000000000000005e1f" as Address;

function pos(id: bigint, aprBps: number, availableLiquidity: bigint, lender: Address = lenderA): LiquidityPosition {
  return { id, lender, market, aprBps, availableLiquidity };
}

describe("selectHydratedRoute", () => {
  it("conserves projected depth against the aggregate before ranking", () => {
    const positions = [pos(1n, 1000, 100n, self), pos(2n, 1000, 50n)];
    expect(
      selectHydratedRoute({
        positions,
        target: 50n,
        aggregateDepth: 140n,
        maxRouteIds: 128,
      }),
    ).toMatchObject({ status: "conservation-failed", projectedDepth: 150n, aggregateDepth: 140n });
  });

  it("includes the connected account's own position in the fill route", () => {
    const positions = [pos(1n, 1000, 100n, self), pos(2n, 1000, 50n)];
    expect(
      selectHydratedRoute({
        positions,
        target: 50n,
        aggregateDepth: 150n,
        maxRouteIds: 128,
      }),
    ).toMatchObject({
      status: "ready",
      publicDepth: 150n,
      executableDepth: 150n,
      selectedDepth: 100n,
      selectedIds: [1n],
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
