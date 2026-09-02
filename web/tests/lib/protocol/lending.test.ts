import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  hydrateLenderCandidates,
  hydrateLoanCandidates,
  loadBorrowerPage,
  loadLenderPage,
  LOANS_OF_FOLLOW_CAP,
  type LendingReadClient,
} from "@/lib/protocol/lending";

const LENDING = "0x0000000000000000000000000000000000000a11" as Address;
const MARKET = "0x0000000000000000000000000000000000000b22" as Address;
const USER = "0x0000000000000000000000000000000000000c33" as Address;
const OTHER = "0x0000000000000000000000000000000000000d44" as Address;

function loan(borrower: Address) {
  return {
    borrower,
    aprBps: 500,
    epoch: 1,
    closed: false,
    market: MARKET,
    seq: 1n,
    streamId: 9n,
    fillStart: 1n,
    fillEnd: 2n,
    obligation: 10n,
    drawn: 10n,
    repaid: 0n,
  };
}

describe("loadBorrowerPage", () => {
  it("returns partial when one candidate hydration fails", async () => {
    const client = {
      async readContract({ functionName, args }: { functionName: string; args: readonly unknown[] }) {
        if (functionName === "borrowerLoanCount") return 2n;
        if (functionName === "borrowerLoanAt") return (args[1] as bigint) + 1n;
        if (functionName === "loanState") {
          if (args[0] === 2n) throw new Error("loanState reverted");
          return [loan(USER), 10n];
        }
        throw new Error(functionName);
      },
    } as unknown as LendingReadClient;

    const outcome = await loadBorrowerPage(client, LENDING, USER, 0n, 2n);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.loans).toHaveLength(1);
    expect(outcome.data.loans[0]?.id).toBe(1n);
  });
});

describe("hydrateLoanCandidates", () => {
  it("drops a log-named loan whose loanState borrower is not the account", async () => {
    const client = {
      async readContract({ args }: { args: readonly unknown[] }) {
        const id = args[0] as bigint;
        return [loan(id === 1n ? USER : OTHER), 10n];
      },
    } as unknown as LendingReadClient;

    const outcome = await hydrateLoanCandidates(client, LENDING, USER, [1n, 2n]);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.loans.map((row) => row.id)).toEqual([1n]);
  });

  it("returns partial when one loanState fails", async () => {
    const client = {
      async readContract({ args }: { args: readonly unknown[] }) {
        const id = args[0] as bigint;
        if (id === 2n) throw new Error("loanState reverted");
        return [loan(USER), 10n];
      },
    } as unknown as LendingReadClient;

    const outcome = await hydrateLoanCandidates(client, LENDING, USER, [1n, 2n]);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.loans.map((row) => row.id)).toEqual([1n]);
  });
});

function storedPosition(lender: Address) {
  return {
    lender,
    market: MARKET,
    aprBps: 500,
  };
}

function neverEndingLoans() {
  return {
    async readContract({
      functionName,
      args,
    }: {
      functionName: string;
      args: readonly unknown[];
    }) {
      if (functionName === "lenderPositionCount") return 1n;
      if (functionName === "lenderPositionAt") return 1n;
      if (functionName === "positionState") {
        return [storedPosition(USER), 1n, 2n, 10n];
      }
      if (functionName === "loansOf") {
        const startSeq = args[1] as bigint;
        return [[{ loanId: startSeq + 1n, contribution: 1n, claimable: 0n }], startSeq + 1n];
      }
      throw new Error(functionName);
    },
  } as unknown as LendingReadClient;
}

describe("loadLenderPage", () => {
  it("returns partial when loansOf hits the follow cap", async () => {
    const outcome = await loadLenderPage(neverEndingLoans(), LENDING, USER, 0n, 1n);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.positions).toHaveLength(1);
    expect(outcome.data.positions[0]?.pairsTruncated).toBe(true);
    expect(outcome.data.positions[0]?.pairs).toHaveLength(LOANS_OF_FOLLOW_CAP + 1);
    expect(outcome.failures[0]?.message).toMatch(/truncated/);
  });
});

describe("hydrateLenderCandidates", () => {
  it("returns partial when loansOf hits the follow cap", async () => {
    const outcome = await hydrateLenderCandidates(neverEndingLoans(), LENDING, USER, [1n]);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.positions[0]?.pairsTruncated).toBe(true);
    expect(outcome.failures[0]?.code).toBe("incomplete");
  });
});
