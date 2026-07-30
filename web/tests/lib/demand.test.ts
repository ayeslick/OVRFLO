import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  aggregateDemand,
  DEMAND_WINDOW_SECONDS,
  demandLevel,
  findDemandCutoffBlock,
  type BorrowDemandEvent,
} from "@/lib/demand";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const SELF = testAddress(0xa11);
const OTHER = testAddress(0xbbb);
const NOW = 1_800_000_000n;

function event(overrides: Partial<BorrowDemandEvent> = {}): BorrowDemandEvent {
  return {
    aprBps: 1000,
    amount: 100n,
    borrower: OTHER,
    blockTimestamp: NOW - 1000n,
    ...overrides,
  };
}

describe("aggregateDemand", () => {
  it("groups events by rate ascending with counts and summed amounts", () => {
    const rows = aggregateDemand(
      [
        event({ aprBps: 1100, amount: 50n }),
        event({ aprBps: 1000, amount: 100n }),
        event({ aprBps: 1000, amount: 30n }),
      ],
      { nowSeconds: NOW },
    );
    expect(rows).toEqual([
      { aprBps: 1000, count: 2, amount: 130n },
      { aprBps: 1100, count: 1, amount: 50n },
    ]);
  });

  it("excludes the connected user's own borrowing — self-demand is not signal", () => {
    const rows = aggregateDemand(
      [event({ borrower: SELF, amount: 500n }), event({ amount: 40n })],
      { nowSeconds: NOW, self: SELF },
    );
    expect(rows).toEqual([{ aprBps: 1000, count: 1, amount: 40n }]);
  });

  it("drops events outside the trailing 30-day window", () => {
    const stale = event({ blockTimestamp: NOW - DEMAND_WINDOW_SECONDS - 1n, amount: 999n });
    const fresh = event({ blockTimestamp: NOW - DEMAND_WINDOW_SECONDS, amount: 10n });
    const rows = aggregateDemand([stale, fresh], { nowSeconds: NOW });
    expect(rows).toEqual([{ aprBps: 1000, count: 1, amount: 10n }]);
  });

  it("matches self case-insensitively", () => {
    const upper = SELF.toUpperCase().replace("0X", "0x") as Address;
    const rows = aggregateDemand([event({ borrower: upper })], { nowSeconds: NOW, self: SELF });
    expect(rows).toEqual([]);
  });
});

describe("demandLevel", () => {
  it("grades qualitatively relative to the market's own peak", () => {
    expect(demandLevel(0n, 300n)).toBe("NONE");
    expect(demandLevel(100n, 300n)).toBe("LOW");
    expect(demandLevel(200n, 300n)).toBe("MODERATE");
    expect(demandLevel(300n, 300n)).toBe("HIGH");
  });

  it("treats a zero peak as no demand anywhere", () => {
    expect(demandLevel(0n, 0n)).toBe("NONE");
  });

  it("flips from LOW to MODERATE the instant amount*3 crosses peak", () => {
    // The inclusive-boundary half (100n) is already pinned by the golden
    // vector above; the crossing at 101n is the novel fact this test adds.
    expect(demandLevel(101n, 300n)).toBe("MODERATE"); // 101*3 == 303 > 300
  });

  it("flips from MODERATE to HIGH the instant amount*3 crosses peak*2", () => {
    expect(demandLevel(201n, 300n)).toBe("HIGH"); // 201*3 == 603 > 600
  });
});

describe("findDemandCutoffBlock", () => {
  it("uses captured chain time and bounded binary search rather than wall clock", async () => {
    const timestamps = new Map<bigint, bigint>([
      [10n, NOW - DEMAND_WINDOW_SECONDS - 10n],
      [11n, NOW - DEMAND_WINDOW_SECONDS],
      [12n, NOW - DEMAND_WINDOW_SECONDS + 10n],
      [20n, NOW],
    ]);
    const reads: bigint[] = [];
    const block = await findDemandCutoffBlock({
      fromBlock: 10n,
      head: { number: 20n, timestamp: NOW },
      getBlock: async (blockNumber) => {
        reads.push(blockNumber);
        return { number: blockNumber, timestamp: timestamps.get(blockNumber) ?? NOW - (20n - blockNumber) * 10n };
      },
    });
    expect(block).toBe(11n);
    expect(reads.length).toBeLessThanOrEqual(5);
  });

  it("returns the deployment anchor when the full history is inside the window", async () => {
    await expect(
      findDemandCutoffBlock({
        fromBlock: 100n,
        head: { number: 101n, timestamp: NOW },
        getBlock: async (number) => ({ number, timestamp: NOW - 1n }),
      }),
    ).resolves.toBe(100n);
  });
});
