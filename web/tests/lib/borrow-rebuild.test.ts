import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { assertBorrowRebuildInputs } from "@/lib/borrow-rebuild";
import { ZERO_ADDRESS } from "@/lib/config";

const book = "0x00000000000000000000000000000000000000c3" as Address;

describe("borrow rebuild inputs", () => {
  it("rejects placeholder depth, eligibility, router, or request", () => {
    expect(
      assertBorrowRebuildInputs({
        routedDepth: null,
        eligibility: "eligible",
        router: ZERO_ADDRESS,
        request: "none",
      }).status,
    ).toBe("invalid");
    expect(
      assertBorrowRebuildInputs({
        routedDepth: 1n,
        eligibility: "unread",
        router: ZERO_ADDRESS,
        request: "none",
      }),
    ).toEqual({ status: "invalid", reason: "placeholder-eligibility" });
    expect(
      assertBorrowRebuildInputs({
        routedDepth: 1n,
        eligibility: "eligible",
        router: null,
        request: "none",
      }),
    ).toEqual({ status: "invalid", reason: "placeholder-router" });
    expect(
      assertBorrowRebuildInputs({
        routedDepth: 1n,
        eligibility: "eligible",
        router: ZERO_ADDRESS,
        request: "unread",
      }),
    ).toEqual({ status: "invalid", reason: "placeholder-request" });
  });

  it("accepts real routed depth, eligibility, and current router/request reads", () => {
    expect(
      assertBorrowRebuildInputs({
        routedDepth: 12n,
        eligibility: "eligible",
        router: ZERO_ADDRESS,
        request: "none",
      }),
    ).toEqual({ status: "ok" });
    expect(
      assertBorrowRebuildInputs({
        routedDepth: 12n,
        eligibility: "ineligible",
        router: book,
        request: { book },
      }),
    ).toEqual({ status: "ok" });
  });
});
