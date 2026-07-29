import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { planClaimAll } from "@/lib/claim-all";

const lendingA = "0x00000000000000000000000000000000000000aa" as Address;
const lendingB = "0x00000000000000000000000000000000000000bb" as Address;
const assetA = "0x00000000000000000000000000000000000000c1" as Address;
const assetB = "0x00000000000000000000000000000000000000c2" as Address;

describe("planClaimAll", () => {
  it("batches pool claims per lending address with ascending loan ids, then streams ascending", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingB, loanId: 7n, claimable: 5n, asset: assetB },
        { lending: lendingA, loanId: 9n, claimable: 1n, asset: assetA },
        { lending: lendingA, loanId: 2n, claimable: 3n, asset: assetA },
      ],
      streams: [
        { streamId: 12n, withdrawable: 4n, asset: assetA },
        { streamId: 3n, withdrawable: 8n, asset: assetA },
      ],
    });
    expect(plan).toEqual([
      { kind: "pool-claims", lending: lendingA, loanIds: [2n, 9n], asset: assetA },
      { kind: "pool-claims", lending: lendingB, loanIds: [7n], asset: assetB },
      { kind: "stream-claim", streamId: 3n, asset: assetA },
      { kind: "stream-claim", streamId: 12n, asset: assetA },
    ]);
  });

  it("excludes zero-claimable pools and zero-withdrawable streams", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingA, loanId: 1n, claimable: 0n, asset: assetA },
        { lending: lendingA, loanId: 2n, claimable: 6n, asset: assetA },
      ],
      streams: [{ streamId: 5n, withdrawable: 0n, asset: assetA }],
    });
    expect(plan).toEqual([{ kind: "pool-claims", lending: lendingA, loanIds: [2n], asset: assetA }]);
  });

  it("returns an empty plan for empty input", () => {
    expect(planClaimAll({ pools: [], streams: [] })).toEqual([]);
  });

  it("groups pools for the same lending address into one batch regardless of casing", () => {
    const upper = lendingA.toUpperCase().replace("0X", "0x") as Address;
    const plan = planClaimAll({
      pools: [
        { lending: lendingA, loanId: 1n, claimable: 3n, asset: assetA },
        { lending: upper, loanId: 2n, claimable: 4n, asset: assetA },
      ],
      streams: [],
    });
    expect(plan).toEqual([{ kind: "pool-claims", lending: lendingA, loanIds: [1n, 2n], asset: assetA }]);
  });
});
