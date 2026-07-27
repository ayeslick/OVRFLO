import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { planClaimAll } from "@/lib/claim-all";

const lendingA = "0x00000000000000000000000000000000000000aa" as Address;
const lendingB = "0x00000000000000000000000000000000000000bb" as Address;

describe("planClaimAll", () => {
  it("batches pool claims per lending address with ascending loan ids, then streams ascending", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingB, loanId: 7n, claimable: 5n },
        { lending: lendingA, loanId: 9n, claimable: 1n },
        { lending: lendingA, loanId: 2n, claimable: 3n },
      ],
      streams: [
        { streamId: 12n, withdrawable: 4n },
        { streamId: 3n, withdrawable: 8n },
      ],
    });
    expect(plan).toEqual([
      { kind: "pool-claims", lending: lendingA, loanIds: [2n, 9n] },
      { kind: "pool-claims", lending: lendingB, loanIds: [7n] },
      { kind: "stream-claim", streamId: 3n },
      { kind: "stream-claim", streamId: 12n },
    ]);
  });

  it("excludes zero-claimable pools and zero-withdrawable streams", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingA, loanId: 1n, claimable: 0n },
        { lending: lendingA, loanId: 2n, claimable: 6n },
      ],
      streams: [{ streamId: 5n, withdrawable: 0n }],
    });
    expect(plan).toEqual([{ kind: "pool-claims", lending: lendingA, loanIds: [2n] }]);
  });

  it("returns an empty plan for empty input", () => {
    expect(planClaimAll({ pools: [], streams: [] })).toEqual([]);
  });
});
