import { describe, expect, it } from "vitest";
import { describeFixedReturnCompletion } from "@/lib/fixed-return-completion";

describe("fixed return completion", () => {
  it("shows Waiting and withdrawable before any match", () => {
    expect(describeFixedReturnCompletion({ filled: 0n, unfilled: 10n, loans: [] })).toEqual({
      status: "waiting",
      withdrawable: true,
    });
  });

  it("hides return and date until authoritative loan reads cover the matched amount", () => {
    expect(
      describeFixedReturnCompletion({
        filled: 5n,
        unfilled: 2n,
        loans: null,
      }),
    ).toEqual({ status: "incomplete-reads" });
    expect(
      describeFixedReturnCompletion({
        filled: 5n,
        unfilled: 2n,
        loans: [{ loanId: 1n, matchedAmount: 3n, completionDate: 99n }],
      }),
    ).toEqual({ status: "incomplete-reads" });
  });

  it("shows one return and date when one loan term covers the matched amount", () => {
    expect(
      describeFixedReturnCompletion({
        filled: 5n,
        unfilled: 0n,
        loans: [{ loanId: 9n, matchedAmount: 5n, completionDate: 1_800n }],
      }),
    ).toMatchObject({
      status: "single-term",
      matchedAmount: 5n,
      completionDate: 1_800n,
      withdrawableUnfilled: false,
    });
  });

  it("summarizes multiple completion dates and keeps the unfilled suffix Waiting", () => {
    const result = describeFixedReturnCompletion({
      filled: 7n,
      unfilled: 3n,
      loans: [
        { loanId: 1n, matchedAmount: 4n, completionDate: 10n },
        { loanId: 2n, matchedAmount: 3n, completionDate: 20n },
      ],
    });
    expect(result).toMatchObject({
      status: "multiple-dates",
      summary: "Multiple completion dates",
      unfilled: 3n,
      withdrawableUnfilled: true,
    });
    if (result.status === "multiple-dates") {
      expect(result.loans).toHaveLength(2);
    }
  });
});
