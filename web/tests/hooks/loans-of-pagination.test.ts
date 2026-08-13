import { describe, expect, it } from "vitest";
import { paginateLoansOf } from "@/hooks/useLenderBook";

describe("paginateLoansOf", () => {
  it("follows nextSeq to exhaustion and never reuses a foreign startSeq", async () => {
    const starts: bigint[] = [];
    const result = await paginateLoansOf(async (startSeq) => {
      starts.push(startSeq);
      if (startSeq === 0n) {
        return {
          entries: [{ loanId: 1n, contribution: 10n, claimable: 1n }],
          nextSeq: 4n,
        };
      }
      if (startSeq === 4n) {
        return {
          entries: [{ loanId: 2n, contribution: 5n, claimable: 2n }],
          nextSeq: 0n,
        };
      }
      throw new Error(`foreign startSeq ${startSeq}`);
    });
    expect(starts).toEqual([0n, 4n]);
    expect(result.pairs.map((pair) => pair.loanId)).toEqual([1n, 2n]);
    expect(result.truncated).toBe(false);
  });

  it("throws when nextSeq is reused", async () => {
    await expect(
      paginateLoansOf(async () => ({
        entries: [{ loanId: 1n, contribution: 1n, claimable: 1n }],
        nextSeq: 3n,
      })),
    ).rejects.toThrow("loansOf nextSeq reused");
  });
});
