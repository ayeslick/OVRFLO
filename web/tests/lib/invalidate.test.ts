import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { invalidateAllOnChainReads, invalidateOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";
import { streamKeys } from "@/lib/query-keys";

const user = "0x0000000000000000000000000000000000000a11" as Address;

describe("invalidateAllOnChainReads", () => {
  it("invalidates exactly the two wagmi roots and the held-streams key", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAllOnChainReads(queryClient, user);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContract"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContracts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: streamKeys.held(user) });
  });

  it("still invalidates the held-streams key (with an undefined user) when no wallet is connected", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAllOnChainReads(queryClient, undefined);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith({ queryKey: streamKeys.held(undefined) });
  });
});

describe("scheduleHeldStreamsRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-invalidates the held key at 2s and 5s while the result set is unchanged", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(streamKeys.held(user), [{ streamId: 1n }]);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    scheduleHeldStreamsRetry(queryClient, user);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(spy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stops early once the result set changes", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(streamKeys.held(user), [{ streamId: 1n }]);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    scheduleHeldStreamsRetry(queryClient, user);
    queryClient.setQueryData(streamKeys.held(user), [{ streamId: 1n }, { streamId: 2n }]);
    vi.advanceTimersByTime(10_000);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns a cleanup that cancels pending retries", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const cancel = scheduleHeldStreamsRetry(queryClient, user);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(spy).not.toHaveBeenCalled();
  });
});

// R39: invalidation used to prefix-match the two wagmi roots, so a write to one
// market refetched every other market's ladder, balances and loan book. These
// assert the scoping actually scopes — a predicate matching everything would
// pass a weaker "was called" check just as well.
describe("invalidateOnChainReads (R39)", () => {
  const MARKET_A = "0x00000000000000000000000000000000000000AA" as Address;
  const MARKET_B = "0x00000000000000000000000000000000000000bb" as Address;

  type Predicate = (q: { queryKey: unknown[] }) => boolean;

  function predicatesFrom(spy: { mock: { calls: unknown[][] } }): Predicate[] {
    return spy.mock.calls
      .map((call) => (call[0] as { predicate?: Predicate }).predicate)
      .filter((p): p is Predicate => typeof p === "function");
  }
  const matchesAny = (preds: Predicate[], queryKey: unknown[]) => preds.some((p) => p({ queryKey }));

  it("invalidates a read whose key names a touched contract", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(true);
  });

  it("leaves an unrelated market's reads alone", () => {
    // The behaviour the whole requirement is about.
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_B }])).toBe(false);
  });

  it("matches case-insensitively, since address casing is not normalised", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A.toLowerCase() as Address] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(true);
  });

  it("invalidates a batched read containing any touched contract", () => {
    // useReadContracts puts several addresses under one key; splitting the batch
    // to be more precise would cost more than the occasional extra refetch.
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    const batch = ["readContracts", { contracts: [{ address: MARKET_B }, { address: MARKET_A }] }];
    expect(matchesAny(predicatesFrom(spy), batch)).toBe(true);
  });

  it("survives a bigint in the key, which JSON cannot serialise by default", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    const key = ["readContract", { address: MARKET_A, args: [123n] }];
    expect(() => matchesAny(predicatesFrom(spy), key)).not.toThrow();
    expect(matchesAny(predicatesFrom(spy), key)).toBe(true);
  });

  it("matches nothing when no contract was recorded, rather than everything", () => {
    // Failing open here would silently restore the old coarse behaviour — which
    // is exactly the bug a missed edit introduced while building this.
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(false);
  });

  it("only touches the held-streams key when the write could move a stream", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateOnChainReads(client, { contracts: [MARKET_A], user });
    expect(spy.mock.calls.map((call) => call[0] as unknown)).not.toContainEqual({ queryKey: streamKeys.held(user) });

    invalidateOnChainReads(client, { contracts: [MARKET_A], user, streams: true });
    expect(spy.mock.calls.map((call) => call[0] as unknown)).toContainEqual({ queryKey: streamKeys.held(user) });
  });
});
