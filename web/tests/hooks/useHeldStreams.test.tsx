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

function heldStream(streamId: bigint, overrides: Partial<HeldStream> = {}): HeldStream {
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
    ...overrides,
  };
}

let fetchHeldStreamIdsMock: (...args: unknown[]) => Promise<HeldStream[]>;
vi.mock("@/lib/ponder", () => ({
  fetchHeldStreamIds: (...args: unknown[]) => fetchHeldStreamIdsMock(...args),
}));

let sablierReadsReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
const readContractsConfig = vi.fn();
vi.mock("wagmi", () => ({
  useReadContracts: (config: unknown) => {
    readContractsConfig(config);
    return sablierReadsReturn;
  },
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

    // Confirms the sablier reads are actually wired to the discovered stream
    // ids (not, say, a fixed empty array) — a hardcoded `contracts: []` would
    // still pass the assertions above via the discovery-time fallback.
    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contracts: [
          expect.objectContaining({ functionName: "withdrawableAmountOf", args: [1n] }),
          expect.objectContaining({ functionName: "withdrawableAmountOf", args: [2n] }),
        ],
      }),
    );
  });

  it("falls back to the discovery-time withdrawable when the fresh sablier read fails", async () => {
    // A nonzero, distinctive fallback value — if the hook ever hardcoded 0n
    // instead of reading `stream.withdrawable`, this would catch it, unlike
    // the previous fixture whose default withdrawable was already 0n.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n, { withdrawable: 42n })]);
    sablierReadsReturn = { data: [{ status: "failure", error: new Error("rpc") }], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.streams[0].withdrawable).toBe(42n);
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

  it("is loading once discovery settles but the sablier reads are still in flight", async () => {
    // Discovery's own `isLoading` is true synchronously on mount regardless
    // of the sablier mock, so asserting isLoading immediately (the previous
    // version) can't tell the OR's right-hand side from its left-hand side —
    // it would pass even if `sablierReads.isLoading` were dropped from the
    // hook entirely. Waiting for discovery to resolve first, then asserting
    // isLoading stays true, isolates the sablier-reads half of the OR.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n)]);
    sablierReadsReturn = { data: undefined, isLoading: true, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(fetchHeldStreamIdsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.isLoading).toBe(true);
  });

  it("is not loading once both discovery and the sablier reads have settled", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([heldStream(1n)]);
    sablierReadsReturn = { data: [success(5n)], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
  });
});
