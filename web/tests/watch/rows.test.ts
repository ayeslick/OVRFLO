import { describe, expect, it } from "vitest";
import {
  borrowedRowState,
  borrowedStateLine,
  positionClaimable,
  positionFilled,
  suppliedMatchState,
  suppliedStateLine,
} from "@/lib/watch-rows";
import type { LenderPositionRow } from "@/hooks/useLenderBook";

const SCALE = 10n ** 18n;

describe("watch rows", () => {
  it("classifies resting, partial, and filled from tape intervals", () => {
    expect(suppliedMatchState(0n, 5n * SCALE)).toBe("resting");
    expect(suppliedMatchState(3n * SCALE, 2n * SCALE)).toBe("partial");
    expect(suppliedMatchState(5n * SCALE, 0n)).toBe("filled");
  });

  it("leads a between-visits fill with the fill on the state line", () => {
    const line = suppliedStateLine({
      match: "partial",
      filled: 31n * 10n ** 17n,
      unfilled: 19n * 10n ** 17n,
      aprBps: 500,
    });
    expect(line.startsWith("FILLED")).toBe(true);
    expect(line).toContain("5.00%");
  });

  it("keeps resting copy inert", () => {
    expect(suppliedStateLine({ match: "resting", filled: 0n, unfilled: 5n * SCALE, aprBps: 500 })).toBe(
      "NOTHING ACCRUES UNTIL MATCHED",
    );
  });

  it("flips a covered loan to close-ready", () => {
    const loan = {
      closed: false,
      obligation: 2n * SCALE,
      drawn: SCALE,
      repaid: 0n,
      outstanding: SCALE / 100n,
    };
    expect(borrowedRowState({ loan, withdrawable: SCALE })).toBe("close-ready");
    expect(borrowedStateLine({ state: "close-ready", streamId: 8n })).toContain("COVERED");
    expect(borrowedStateLine({ state: "repaying", streamId: 8n, scheduleHydrated: false })).toBe(
      "CHECKING… · STREAM REPAYING",
    );
    expect(borrowedStateLine({ state: "repaying", streamId: 8n, scheduleHydrated: true })).toBe(
      "UNCOVERED · STREAM REPAYING",
    );
  });

  it("keeps closed loans settled and names a returned stream", () => {
    const loan = {
      closed: true,
      obligation: SCALE,
      drawn: SCALE,
      repaid: 0n,
      outstanding: 0n,
    };
    expect(borrowedRowState({ loan })).toBe("settled");
    expect(borrowedStateLine({ state: "settled", streamId: 441n, streamPresent: true })).toBe(
      "RETURNED STREAM #441",
    );
  });

  it("names a burned or absent NFT as gone, not returned", () => {
    expect(borrowedStateLine({ state: "settled", streamId: 441n, streamPresent: false })).toBe(
      "STREAM #441 GONE",
    );
  });

  it("sums claimable pairs and filled interval", () => {
    const row = {
      intervalStart: 0n,
      intervalEnd: 3n * SCALE,
      pairs: [
        { loanId: 1n, contribution: 2n * SCALE, claimable: 10n },
        { loanId: 2n, contribution: SCALE, claimable: 5n },
      ],
    } as Pick<LenderPositionRow, "intervalStart" | "intervalEnd" | "pairs">;
    expect(positionFilled(row)).toBe(3n * SCALE);
    expect(positionClaimable(row)).toBe(15n);
  });
});
