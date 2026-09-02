import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  compareCollectionRows,
  groupTotalsByUnderlying,
  loanLifecycle,
  supplyLifecycle,
} from "@/lib/portfolio-status";

const A = "0x0000000000000000000000000000000000000a11" as Address;
const B = "0x0000000000000000000000000000000000000b22" as Address;
const SCALE = 10n ** 18n;

describe("lifecycle", () => {
  it("marks a closed or zero-outstanding loan completed", () => {
    expect(loanLifecycle({ closed: true, outstanding: SCALE })).toBe("completed");
    expect(loanLifecycle({ closed: false, outstanding: 0n })).toBe("completed");
    expect(loanLifecycle({ closed: false, outstanding: SCALE })).toBe("active");
  });

  it("marks unmatched supply waiting and keeps matched supply reachable", () => {
    expect(
      supplyLifecycle({ intervalStart: 0n, intervalEnd: 0n, availableLiquidity: SCALE }),
    ).toBe("waiting");
    expect(
      supplyLifecycle({ intervalStart: 0n, intervalEnd: SCALE, availableLiquidity: SCALE }),
    ).toBe("working");
    expect(
      supplyLifecycle({ intervalStart: 0n, intervalEnd: SCALE, availableLiquidity: 0n }),
    ).toBe("active");
  });
});

describe("groupTotalsByUnderlying", () => {
  it("never sums unlike symbols and keeps same-underlying totals exact", () => {
    expect(
      groupTotalsByUnderlying([
        { underlying: A, symbol: "ovrfloA", amount: 3n },
        { underlying: A, symbol: "ovrfloA", amount: 4n },
        { underlying: B, symbol: "ovrfloB", amount: 5n },
      ]),
    ).toEqual([
      { underlying: A, symbol: "ovrfloA", amount: 7n, count: 2 },
      { underlying: B, symbol: "ovrfloB", amount: 5n, count: 1 },
    ]);
  });
});

describe("compareCollectionRows", () => {
  const waiting = { id: 2n, status: "waiting" as const, amount: 1n };
  const completed = { id: 1n, status: "completed" as const, amount: 9n };
  const active = { id: 3n, status: "active" as const, amount: 4n };

  it("reorders by status without dropping completed or waiting rows", () => {
    const rows = [completed, active, waiting];
    const sorted = [...rows].sort((left, right) => compareCollectionRows(left, right, "status"));
    expect(sorted.map((row) => row.status)).toEqual(["waiting", "active", "completed"]);
    expect(sorted).toHaveLength(3);
  });

  it("reorders by amount without changing the hydrated set", () => {
    const rows = [waiting, completed, active];
    const sorted = [...rows].sort((left, right) => compareCollectionRows(left, right, "amount"));
    expect(sorted.map((row) => row.id)).toEqual([1n, 3n, 2n]);
  });
});
