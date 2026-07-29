import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import type { HeldStream } from "@/lib/types";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const OTHER = "0x0000000000000000000000000000000000000b22" as Address;
const SENDER = "0x0000000000000000000000000000000000000333" as Address;
const ASSET = "0x0000000000000000000000000000000000000444" as Address;

// R37/M-9: the indexer answers exactly one question — which ids might be mine.
// Everything the app displays or gates on comes from Sablier, so these fixtures
// deliberately give the indexer *wrong* values: any test that passes by reading
// them has caught the regression.
function indexed(streamId: bigint, overrides: Partial<HeldStream> = {}): HeldStream {
  return {
    streamId,
    recipient: OTHER,
    sender: "0x00000000000000000000000000000000deadbeef" as Address,
    asset: "0x00000000000000000000000000000000feedface" as Address,
    endTime: 1n,
    canceled: true,
    depleted: true,
    deposited: 1n,
    withdrawn: 1n,
    withdrawable: 1n,
    ...overrides,
  };
}

function onChainStream(overrides: Record<string, unknown> = {}) {
  return {
    sender: SENDER,
    startTime: 1_700_000_000,
    cliffTime: 1_700_000_000,
    isCancelable: false,
    wasCanceled: false,
    asset: ASSET,
    endTime: 1_800_000_000,
    isDepleted: false,
    isStream: true,
    isTransferable: true,
    amounts: { deposited: 100n, withdrawn: 10n, refunded: 0n },
    ...overrides,
  };
}

let fetchHeldStreamIdsMock: (...args: unknown[]) => Promise<HeldStream[]>;
vi.mock("@/lib/ponder", () => ({
  fetchHeldStreamIds: (...args: unknown[]) => fetchHeldStreamIdsMock(...args),
}));

let chainReadsReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
const readContractsConfig = vi.fn();
vi.mock("wagmi", () => ({
  useReadContracts: (config: unknown) => {
    readContractsConfig(config);
    return chainReadsReturn;
  },
}));

const success = (result: unknown) => ({ status: "success" as const, result });
const failure = () => ({ status: "failure" as const, error: new Error("rpc") });

// Three reads per stream, in the order the hook issues them.
const readsFor = (stream: unknown, withdrawable: bigint, owner: Address) => [
  success(stream),
  success(withdrawable),
  success(owner),
];

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useHeldStreams — chain is the source of truth (R37)", () => {
  it("takes every displayed field from Sablier, not the indexer", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, USER), isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));

    const stream = result.current.streams[0];
    expect(stream.sender).toBe(SENDER);
    expect(stream.asset).toBe(ASSET);
    expect(stream.endTime).toBe(1_800_000_000n);
    expect(stream.canceled).toBe(false);
    expect(stream.depleted).toBe(false);
    expect(stream.deposited).toBe(100n);
    expect(stream.withdrawn).toBe(10n);
    expect(stream.withdrawable).toBe(5n);
    // The indexer claimed all of the above differently; none of it survived.
  });

  it("Covers AE6. Drops a stream the connected address does not own on-chain", async () => {
    // The indexer says it is the user's; ownerOf says otherwise. The chain wins.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n, { recipient: USER })]);
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, OTHER), isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(fetchHeldStreamIdsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streams).toEqual([]);
  });

  it("reports the on-chain owner as the recipient", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: readsFor(onChainStream(), 0n, USER), isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.streams[0].recipient).toBe(USER);
  });

  it("drops an id the chain does not recognise as a stream", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = {
      data: readsFor(onChainStream({ isStream: false }), 0n, USER),
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streams).toEqual([]);
  });

  it("drops a stream whose record read failed rather than falling back to the indexer", async () => {
    // Falling back here is precisely the behaviour R37 removes: an unresolved
    // read is not evidence, and the indexer's copy is what must not be trusted.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: [failure(), success(5n), success(USER)], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.streams).toEqual([]);
  });

  it("keeps a stream whose withdrawable read failed, reporting zero claimable", async () => {
    // The record and owner both resolved, so ownership and eligibility are
    // known — only the live claimable figure is missing, and zero understates
    // rather than overstates it.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: [success(onChainStream()), failure(), success(USER)], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.streams[0].withdrawable).toBe(0n);
  });

  it("keeps only the streams that survive, preserving order", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n), indexed(2n), indexed(3n)]);
    chainReadsReturn = {
      data: [
        ...readsFor(onChainStream(), 1n, USER),
        ...readsFor(onChainStream(), 2n, OTHER), // not ours
        ...readsFor(onChainStream(), 3n, USER),
      ],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(2));
    expect(result.current.streams.map((s) => s.streamId)).toEqual([1n, 3n]);
  });

  it("issues all three reads per discovered id", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n), indexed(2n)]);
    chainReadsReturn = {
      data: [...readsFor(onChainStream(), 1n, USER), ...readsFor(onChainStream(), 2n, USER)],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(2));

    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contracts: [
          expect.objectContaining({ functionName: "getStream", args: [1n] }),
          expect.objectContaining({ functionName: "withdrawableAmountOf", args: [1n] }),
          expect.objectContaining({ functionName: "ownerOf", args: [1n] }),
          expect.objectContaining({ functionName: "getStream", args: [2n] }),
          expect.objectContaining({ functionName: "withdrawableAmountOf", args: [2n] }),
          expect.objectContaining({ functionName: "ownerOf", args: [2n] }),
        ],
      }),
    );
  });
});

describe("useHeldStreams — lifecycle", () => {
  it("does not query discovery at all when no user is connected", () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([]);
    chainReadsReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(undefined), { wrapper });
    expect(result.current.streams).toEqual([]);
    expect(fetchHeldStreamIdsMock).not.toHaveBeenCalled();
  });

  it("propagates a discovery failure as the hook's error", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockRejectedValue(new Error("indexer down"));
    chainReadsReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect((result.current.error as Error).message).toBe("indexer down");
  });

  it("is loading once discovery settles but the chain reads are still in flight", async () => {
    // Discovery's own isLoading is true synchronously on mount, so asserting
    // immediately could not tell the two halves of the OR apart.
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: undefined, isLoading: true, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(fetchHeldStreamIdsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(true));
  });

  it("is not loading once both discovery and the chain reads have settled", async () => {
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, USER), isLoading: false, error: null };

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
  });
});
