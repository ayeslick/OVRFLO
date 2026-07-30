import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { streamKeys } from "@/lib/query-keys";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const OTHER = "0x0000000000000000000000000000000000000b22" as Address;
const SENDER = "0x0000000000000000000000000000000000000333" as Address;
const ASSET = "0x0000000000000000000000000000000000000444" as Address;

// R37/M-9: the indexer answers exactly one question — which ids might be mine.
// Everything the app displays or gates on comes from Sablier, so these fixtures
// deliberately give the indexer *wrong* values: any test that passes by reading
// them has caught the regression.
// Discovery yields ids only now (R38): the endpoint returns nothing else,
// because R37 made every other field dead. There is no longer an indexer copy
// of recipient/sender/asset to accidentally trust.
function indexed(streamId: bigint): bigint {
  return streamId;
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

let fetchHeldStreamIdsMock: (...args: unknown[]) => Promise<bigint[]>;
vi.mock("@/lib/ponder", () => ({
  fetchHeldStreamIds: (...args: unknown[]) => fetchHeldStreamIdsMock(...args),
}));

let browserDiscoveryEnabled = true;
vi.mock("@/lib/browser-runtime", () => ({
  canStartBrowserDiscovery: () => browserDiscoveryEnabled,
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

beforeEach(() => {
  browserDiscoveryEnabled = true;
});

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
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([indexed(1n)]);
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

  it("does not start discovery or chain hydration during prerender", () => {
    browserDiscoveryEnabled = false;
    fetchHeldStreamIdsMock = vi.fn().mockResolvedValue([1n]);
    chainReadsReturn = { data: [], isLoading: false, error: null };

    renderHook(() => useHeldStreams(USER), { wrapper });

    expect(fetchHeldStreamIdsMock).not.toHaveBeenCalled();
    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { enabled: false } }),
    );
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

// R43: past ten minutes the cached id set is discarded rather than shown behind
// a warning — an hour-old list of streams is not "slightly stale", it is a
// different picture of the user's holdings.
describe("useHeldStreams — the stale cutoff is a deadline, not a render-time check", () => {
  beforeEach(() => {
    // shouldAdvanceTime keeps waitFor working: it needs the clock to move on its
    // own between polls, while still allowing a jump to the deadline.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, localWrapper };
  }

  it("discards the cache when the deadline passes with nothing else rendering", async () => {
    // The bug this covers: the cutoff used to be `Date.now() - dataUpdatedAt`
    // evaluated during render, and the consumer that matters most —
    // PositionSummary — has no clock, none of its reads poll, and it re-renders
    // only when a position changes. So the clock could run hours past the
    // deadline while a ten-minute-old set went on backing CLAIM ALL. Nothing in
    // this test renders the hook after the failure; the expiry has to fire on
    // its own or not at all.
    fetchHeldStreamIdsMock = vi
      .fn()
      .mockResolvedValueOnce([indexed(1n)])
      .mockRejectedValue(new Error("indexer down"));
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, USER), isLoading: false, error: null };
    const { queryClient, localWrapper } = setup();

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: streamKeys.held(USER) });
    });
    // The error lands one commit after the refetch promise settles.
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.streams).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    });

    expect(result.current.streams).toEqual([]);
    expect(result.current.stale).toBe(false);
    // Past the deadline there is nothing to show and no way to find out, so the
    // caller must render the direct-contract route (R44) — not an empty list.
    expect(result.current.unavailable).toBe(true);
  });

  it("keeps serving the cache right up to the deadline", async () => {
    fetchHeldStreamIdsMock = vi
      .fn()
      .mockResolvedValueOnce([indexed(1n)])
      .mockRejectedValue(new Error("indexer down"));
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, USER), isLoading: false, error: null };
    const { queryClient, localWrapper } = setup();

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: streamKeys.held(USER) });
    });
    await waitFor(() => expect(result.current.stale).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1000);
    });

    expect(result.current.streams).toHaveLength(1);
    expect(result.current.stale).toBe(true);
  });

  it("un-expires when discovery recovers, rather than latching", async () => {
    fetchHeldStreamIdsMock = vi
      .fn()
      .mockResolvedValueOnce([indexed(1n)])
      .mockRejectedValueOnce(new Error("indexer down"))
      .mockResolvedValue([indexed(1n)]);
    chainReadsReturn = { data: readsFor(onChainStream(), 5n, USER), isLoading: false, error: null };
    const { queryClient, localWrapper } = setup();

    const { result } = renderHook(() => useHeldStreams(USER), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.streams).toHaveLength(1));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: streamKeys.held(USER) });
    });
    await waitFor(() => expect(result.current.stale).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    });
    expect(result.current.unavailable).toBe(true);

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: streamKeys.held(USER) });
    });

    await waitFor(() => expect(result.current.unavailable).toBe(false));
    expect(result.current.stale).toBe(false);
    expect(result.current.streams).toHaveLength(1);
  });
});
