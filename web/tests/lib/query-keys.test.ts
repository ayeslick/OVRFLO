import { describe, expect, it } from "vitest";
import {
  borrowerBookKeys,
  demandKeys,
  freshnessKeys,
  ladderKeys,
  lenderBookKeys,
  projectionKeys,
  streamKeys,
  usdKeys,
} from "@/lib/query-keys";

const USER_A = "0x1234567890abcdef1234567890abcdef12345678" as const;
const USER_B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;

describe("streamKeys", () => {
  it("roots every derived key under the same top-level namespace", () => {
    expect(streamKeys.all).toEqual(["streams"]);
    expect(streamKeys.held(USER_A)[0]).toBe(streamKeys.all[0]);
  });

  it("produces distinct keys for distinct users", () => {
    expect(streamKeys.held(USER_A)).toEqual(["streams", "held", USER_A]);
    expect(streamKeys.held(USER_A)).not.toEqual(streamKeys.held(USER_B));
  });

  it("keeps null/undefined users distinguishable from a real address (no collapsing to one shared cache entry)", () => {
    expect(streamKeys.held(null)).toEqual(["streams", "held", null]);
    expect(streamKeys.held(undefined)).toEqual(["streams", "held", undefined]);
    expect(streamKeys.held(null)).not.toEqual(streamKeys.held(USER_A));
  });
});

describe("demandKeys", () => {
  it("roots every derived key under the same top-level namespace, distinct from streamKeys", () => {
    expect(demandKeys.all).toEqual(["demand"]);
    expect(demandKeys.market(USER_A)[0]).toBe(demandKeys.all[0]);
    expect(demandKeys.all[0]).not.toBe(streamKeys.all[0]);
  });

  it("produces distinct keys per market", () => {
    expect(demandKeys.market(USER_A)).toEqual(["demand", "market", USER_A]);
    expect(demandKeys.market(USER_A)).not.toEqual(demandKeys.market(USER_B));
  });

  it("never collides with a streamKeys key even when called with the same address", () => {
    expect(demandKeys.market(USER_A)).not.toEqual(streamKeys.held(USER_A));
  });
});

describe("projectionKeys", () => {
  const anchor = {
    number: 100n,
    hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  };

  it("keys stable scope identity without captured heads", () => {
    const key = projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending: USER_A,
      kind: "market-apr",
      market: USER_B,
      aprBps: 1000,
    });
    expect(key).toEqual([
      "projection",
      1,
      1,
      "100",
      anchor.hash,
      USER_A,
      "market-apr",
      USER_B,
      1000,
      null,
      "primary",
    ]);
    expect(key.join(":")).not.toContain("latest");
    expect(key.join(":")).not.toContain("finalized");
  });

  it("keeps independent Claim All verifier cache state separate", () => {
    const primary = projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      kind: "claim-verifier",
      account: USER_A,
      transportRole: "primary",
    });
    const verifier = projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      kind: "claim-verifier",
      account: USER_A,
      transportRole: "verifier",
    });
    expect(primary).not.toEqual(verifier);
  });
});

describe("watch-surface query factories", () => {
  it("keeps chainId and addresses on custom keys, and stringifies entity ids", () => {
    expect(streamKeys.candidates(1, USER_A)).toEqual(["streams", "candidates", 1, USER_A]);
    expect(ladderKeys.market(1, USER_A, USER_B)[0]).toBe("ladder");
    expect(lenderBookKeys.loansOf(1, USER_A, 5n)).toEqual([
      "lender-book",
      "loans-of",
      1,
      USER_A,
      "5",
    ]);
    expect(lenderBookKeys.loansOf(1, USER_A, 5n)).toEqual(lenderBookKeys.loansOf(1, USER_A, "5"));
    expect(borrowerBookKeys.account(1, USER_A, USER_B)[0]).toBe("borrower-book");
    expect(usdKeys.price(1, USER_A, USER_B)[0]).toBe("usd");
    expect(freshnessKeys.scope(1, USER_A)[0]).toBe("freshness");
  });
});
