import { describe, expect, it } from "vitest";
import {
  MAX_READ_FAILURES,
  isFreshReady,
  loadingOutcome,
  partialOutcome,
  readFailure,
  readyOutcome,
  refreshFailureOutcome,
  unavailableOutcome,
} from "@/lib/read-outcome";

describe("read outcomes", () => {
  const failure = readFailure("hydration", "subcall", new Error("ownerOf reverted"), {
    index: 1,
    entityId: "7",
    retryable: true,
  });

  it("uses one explicit loading/ready/partial/unavailable vocabulary with structured failures", () => {
    expect(loadingOutcome<number[]>().status).toBe("loading");
    expect(readyOutcome([1], { scopeKey: "market:1" })).toMatchObject({
      status: "ready",
      freshness: "fresh",
      complete: true,
      data: [1],
    });
    expect(partialOutcome([1], [failure], { scopeKey: "market:1" })).toMatchObject({
      status: "partial",
      freshness: "fresh",
      complete: false,
      data: [1],
      failures: [
        {
          source: "hydration",
          code: "subcall",
          message: "ownerOf reverted",
          index: 1,
          entityId: "7",
          retryable: true,
        },
      ],
    });
    expect(unavailableOutcome<number[]>([failure], { scopeKey: "market:1" })).toMatchObject({
      status: "unavailable",
      complete: false,
    });
  });

  it("retains a prior complete snapshot as stale after refresh failure", () => {
    const prior = readyOutcome([1, 2], {
      scopeKey: "account:alice",
      blockNumber: 100n,
    });
    const outcome = refreshFailureOutcome(prior, failure);

    expect(outcome).toMatchObject({
      status: "ready",
      freshness: "stale",
      complete: true,
      data: [1, 2],
      failures: [failure],
    });
    expect(isFreshReady(outcome)).toBe(false);
  });

  it("keeps successful partial data but never upgrades it to complete after refresh failure", () => {
    const prior = partialOutcome([1], [failure], { scopeKey: "account:alice" });
    const refreshFailure = readFailure("routing", "transport", "RPC unavailable");
    const outcome = refreshFailureOutcome(prior, refreshFailure);

    expect(outcome).toMatchObject({
      status: "partial",
      freshness: "stale",
      complete: false,
      data: [1],
    });
    expect(outcome.failures).toHaveLength(2);
  });

  it("returns unavailable when refresh fails without any usable snapshot", () => {
    const outcome = refreshFailureOutcome(undefined, failure);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.failures).toEqual([failure]);
  });

  it("deduplicates repeated refresh failures and bounds distinct failure history", () => {
    const stale = refreshFailureOutcome(readyOutcome([1]), failure);
    expect(refreshFailureOutcome(stale, failure)).toBe(stale);

    let outcome = stale;
    for (let index = 0; index < MAX_READ_FAILURES + 5; index++) {
      outcome = refreshFailureOutcome(
        outcome,
        readFailure("refresh", "transport", `RPC failure ${index}`),
      );
    }
    expect(outcome.failures).toHaveLength(MAX_READ_FAILURES);
    expect(outcome.failures.at(-1)?.message).toBe(
      `RPC failure ${MAX_READ_FAILURES + 4}`,
    );
  });

  it("preserves prior data when loading or unavailable reads fail again", () => {
    const loading = refreshFailureOutcome(loadingOutcome([1]), failure);
    expect(loading).toMatchObject({
      status: "partial",
      freshness: "stale",
      data: [1],
    });

    const unavailable = unavailableOutcome([failure], {}, [2]);
    const refreshed = refreshFailureOutcome(
      unavailable,
      readFailure("refresh", "transport", "RPC unavailable"),
    );
    expect(refreshed).toMatchObject({
      status: "unavailable",
      data: [2],
      failures: [failure, { message: "RPC unavailable" }],
    });
  });
});
