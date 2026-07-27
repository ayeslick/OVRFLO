import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { invalidateAllOnChainReads, scheduleHeldStreamsRetry } from "@/lib/invalidate";
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
