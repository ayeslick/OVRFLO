import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import type { HeldStream } from "@/lib/types";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const SENDER = "0x0000000000000000000000000000000000000333" as Address;
const ASSET = "0x0000000000000000000000000000000000000444" as Address;

function heldStream(streamId: bigint): HeldStream {
  return {
    streamId,
    recipient: USER,
    sender: SENDER,
    asset: ASSET,
    endTime: 1_800_000_000n,
    canceled: false,
    depleted: false,
    deposited: 100n,
    withdrawn: 0n,
    withdrawable: 0n,
  };
}

let fetchHeldStreamIdsMock: (...args: unknown[]) => Promise<HeldStream[]>;
vi.mock("@/lib/ponder", () => ({
  fetchHeldStreamIds: (...args: unknown[]) => fetchHeldStreamIdsMock(...args),
}));

let sablierReadsReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
vi.mock("wagmi", () => ({
  useReadContracts: () => sablierReadsReturn,
}));

const success = (result: unknown) => ({ status: "success" as const, result });

function wrapper({ children }: { children: ReactNode }) {
  // retry: false — without it, react-query's default 3 retries with backoff
  // push the rejected-query test past waitFor's timeout for no real reason.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useHeldStreams", () => {
  it("overlays fresh withdrawable amounts onto the ponder-discovered streams", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n), heldStream(2n)]);
    sablierReadsReturn = { data: [success(5n), success(9n)], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(2));
    expect(result.current.streams[0].withdrawable).toBe(5n);
    expect(result.current.streams[1].withdrawable).toBe(9n);
  });

  it("falls back to the discovery-time withdrawable when the fresh sablier read fails", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n)]);
    sablierReadsReturn = { data: [{ status: "failure", error: new Error("rpc") }], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.streams[0].withdrawable).toBe(0n);
  });

  it("does not query discovery at all when no user is connected", () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([]);
    sablierReadsReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(undefined), { wrapper });
    expect(result.current.streams).toEqual([]);
    expect(fetchHeldStreamIdsMock).not.toHaveBeenCalled();
  });

  it("propagates a discovery failure as the hook's error", async () => {
    const discoveryError = new Error("indexer down");
    fetchHeldStreamIdsMock = vi.fn().mockRejectedValue(discoveryError);
    sablierReadsReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect((result.current.error as Error).message).toBe("indexer down");
  });

  it("is loading while either discovery or the sablier reads are in flight", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n)]);
    sablierReadsReturn = { data: undefined, isLoading: true, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
  });
});
