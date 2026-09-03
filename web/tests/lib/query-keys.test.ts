import { describe, expect, it } from "vitest";
import {
  activityKeys,
  borrowKeys,
  borrowerBookKeys,
  demandKeys,
  freshnessKeys,
  ladderKeys,
  lenderBookKeys,
  projectionKeys,
  requestBookKeys,
  streamBookKeys,
  usdKeys,
} from "@/lib/query-keys";

const USER_A = "0x1234567890abcdef1234567890abcdef12345678" as const;
const USER_B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;

describe("demandKeys", () => {
  it("roots every derived key under the same top-level namespace", () => {
    expect(demandKeys.all).toEqual(["demand"]);
    expect(demandKeys.market(USER_A)[0]).toBe(demandKeys.all[0]);
  });

  it("produces distinct keys per market", () => {
    expect(demandKeys.market(USER_A)).toEqual(["demand", "market", USER_A]);
    expect(demandKeys.market(USER_A)).not.toEqual(demandKeys.market(USER_B));
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
    expect(
      activityKeys.account(1, USER_A, 0n, 10n, USER_A, [USER_A], [USER_B]),
    ).not.toEqual(activityKeys.account(1, USER_A, 0n, 10n, USER_A, [USER_A], []));
    expect(activityKeys.account(1, USER_A, 0n, 10n, USER_A, [USER_A], [USER_B])[0]).toBe(
      activityKeys.all[0],
    );
    expect(usdKeys.price(1, USER_A, USER_B)[0]).toBe("usd");
    expect(freshnessKeys.scope(1, USER_A)[0]).toBe("freshness");
    expect(requestBookKeys.factory(1, USER_A, [USER_B])[0]).toBe(requestBookKeys.all[0]);
    expect(requestBookKeys.factory(1, USER_A, [USER_B])).toEqual([
      "request-book",
      "factory",
      1,
      USER_A,
      USER_B,
    ]);
  });

  it("lowercases the pin hash on stream book keys so invalidation can match", () => {
    const mixed = `0x${"AB".repeat(32)}`;
    const wall = streamBookKeys.wall(1, USER_A, USER_B, mixed);
    const complete = streamBookKeys.complete(1, USER_A, USER_B, mixed);
    expect(wall[wall.length - 1]).toBe(mixed.toLowerCase());
    expect(complete[complete.length - 1]).toBe(mixed.toLowerCase());
    expect(wall[0]).toBe(streamBookKeys.all[0]);
  });
});

describe("borrowKeys", () => {
  it("tuples quote identity with addr and id normalization", () => {
    const key = borrowKeys.quote(1, USER_A, USER_B, 31n, 1000, 4n);
    expect(key).toEqual(["borrow", "quote", 1, USER_A, USER_B, "31", 1000, "4"]);
    expect(key[0]).toBe(borrowKeys.all[0]);
    expect(borrowKeys.quote(1, USER_A.toUpperCase() as typeof USER_A, USER_B, 31n, 1000, 4n)[3]).toBe(USER_A);
  });
});
