import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useEffect, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useStreams } from "@/hooks/useStreams";
import { AUTO_INELIGIBLE_PAGE_CAP } from "@/lib/stream-book";
import { MAX_ENUMERATION_IDS, MIN_STREAM_AMOUNT, STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { readyOutcome, unavailableOutcome, partialOutcome, readFailure } from "@/lib/read-outcome";
import type { StreamView } from "@/lib/protocol/streams";
import { streamBookKeys } from "@/lib/query-keys";
import { chainId } from "@/lib/config";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;
const VAULT = "0x00000000000000000000000000000000000000b2" as Address;
const TOKEN = "0x00000000000000000000000000000000000000c3" as Address;
const MARKET = "0x00000000000000000000000000000000000000e5" as Address;

const { LOCKUP, loadStreamPage, publicCall, pinCtl } = vi.hoisted(() => {
  const HASH_A = `0x${"aa".repeat(32)}` as Hash;
  const HASH_B = `0x${"bb".repeat(32)}` as Hash;
  let current = { blockNumber: 10n, blockHash: HASH_A };
  const listeners = new Set<() => void>();
  return {
    LOCKUP: "0x0000000000000000000000000000000000000f66" as Address,
    loadStreamPage: vi.fn(),
    publicCall: vi.fn(),
    pinCtl: {
      HASH_A,
      HASH_B,
      get: () => current,
      set(next: { blockNumber: bigint; blockHash: Hash }) {
        current = next;
        for (const listener of listeners) listener();
      },
      reset() {
        current = { blockNumber: 10n, blockHash: HASH_A };
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      advancePin: vi.fn(async () => {
        current = { blockNumber: 11n, blockHash: HASH_B };
        for (const listener of listeners) listener();
      }),
    },
  };
});

const PIN_HASH = pinCtl.HASH_A;

vi.mock("@/hooks/useProtocolBootstrap", () => ({
  useProtocolBootstrap: () => ({
    status: "ready" as const,
    factory: "0x0000000000000000000000000000000000000f00" as Address,
    stream: LOCKUP,
    vaults: [],
    blockNumber: 1n,
  }),
}));

vi.mock("@/hooks/useEnumerationPin", () => ({
  useEnumerationPin: () => {
    const [pin, setPin] = useState(pinCtl.get());
    useEffect(() => pinCtl.subscribe(() => setPin(pinCtl.get())), []);
    return {
      pin,
      mode: "hash" as const,
      blockTimestamp: 1n,
      headUpdatedAt: 1_000,
      stale: false,
      advancePin: pinCtl.advancePin,
      markFresh: vi.fn(),
    };
  },
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ call: publicCall, getBlock: vi.fn() }),
}));

vi.mock("@/lib/protocol/streams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol/streams")>();
  return { ...actual, loadStreamPage };
});

function encodeUint(value: bigint) {
  return { data: `0x${value.toString(16).padStart(64, "0")}` as `0x${string}` };
}

function view(streamId: bigint, overrides: Partial<StreamView> = {}): StreamView {
  return {
    streamId,
    owner: ACCOUNT,
    sender: VAULT,
    asset: TOKEN,
    startTime: 1_000,
    cliffTime: 1_000,
    endTime: 2_000,
    deposited: MIN_STREAM_AMOUNT * 2n,
    withdrawn: 0n,
    refunded: 0n,
    withdrawableAmount: 1n,
    status: 1,
    isCancelable: false,
    isDepleted: false,
    wasCanceled: false,
    ok: true,
    ...overrides,
  };
}

const input = {
  account: ACCOUNT,
  vaults: [{ vault: VAULT, ovrfloToken: TOKEN }],
  markets: [{ vault: VAULT, market: MARKET, ovrfloToken: TOKEN, expiryCached: 2_000n }],
  registryComplete: true,
  now: 1_500n,
  stream: LOCKUP,
};

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

describe("useStreams lens pager", () => {
  beforeEach(() => {
    loadStreamPage.mockReset();
    publicCall.mockReset();
    pinCtl.reset();
    pinCtl.advancePin.mockReset();
    pinCtl.advancePin.mockImplementation(async () => {
      pinCtl.set({ blockNumber: 11n, blockHash: pinCtl.HASH_B });
    });
    publicCall.mockResolvedValue(encodeUint(1n));
    loadStreamPage.mockResolvedValue(readyOutcome({ streams: [view(5n)] }));
  });

  it("hydrates page one from loadStreamPage and keeps ids as bigint", async () => {
    const queryClient = client();
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(1);
    expect(result.current.data.streams[0]?.streamId).toBe(5n);
    expect(typeof result.current.data.streams[0]?.streamId).toBe("bigint");
    expect(loadStreamPage).toHaveBeenCalled();
    const [, , , start, stop] = loadStreamPage.mock.calls[0] as unknown[];
    expect(start).toBe(0n);
    expect(stop).toBe(1n);
  });

  it("puts the lowercased pin hash in the query key", async () => {
    const queryClient = client();
    renderHook(() => useStreams(input), { wrapper: wrapper(queryClient) });
    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    });
    const key = streamBookKeys.wall(chainId, LOCKUP, ACCOUNT, PIN_HASH);
    expect(key[key.length - 1]).toBe(PIN_HASH.toLowerCase());
    expect(
      queryClient.getQueryCache().getAll().some((entry) => entry.queryKey[0] === streamBookKeys.all[0]),
    ).toBe(true);
  });

  it("returns ready-empty for zero balance without calling streamsOfOwnerIn", async () => {
    publicCall.mockResolvedValue(encodeUint(0n));
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toEqual([]);
    expect(result.current.data.confirmedEmpty).toBe(true);
    expect(loadStreamPage).not.toHaveBeenCalled();
  });

  it("does not fire the pager when the wallet is disconnected", () => {
    const { result } = renderHook(() => useStreams({ ...input, account: null }), {
      wrapper: wrapper(client()),
    });
    expect(result.current.status).toBe("loading");
    expect(loadStreamPage).not.toHaveBeenCalled();
  });

  it("keeps a zero-row failed page as partial, not loading", async () => {
    loadStreamPage.mockResolvedValue(
      partialOutcome({ streams: [] }, [readFailure("loadStreamPage", "subcall", "ownerOf reverted")]),
    );
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("partial");
    });
    if (result.current.status !== "partial") throw new Error("expected partial");
    expect(result.current.complete).toBe(false);
    expect(result.current.data.streams).toEqual([]);
    expect(result.current.failures[0]?.message).toMatch(/ownerOf/);
  });

  it("does not refuse a book larger than MAX_ENUMERATION_IDS", async () => {
    publicCall.mockResolvedValue(encodeUint(MAX_ENUMERATION_IDS + 1n));
    loadStreamPage.mockResolvedValue(
      readyOutcome({
        streams: Array.from({ length: Number(STREAM_PAGE_SIZE) }, (_, index) => view(BigInt(index + 1))),
      }),
    );
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("partial");
    });
    if (result.current.status !== "partial") throw new Error("expected partial");
    expect(result.current.complete).toBe(false);
    expect(result.current.data.complete).toBe(false);
    expect(result.current.data.sourceCount).toBe(MAX_ENUMERATION_IDS + 1n);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.status).not.toBe("unavailable");
  });

  it("resumes the next page at the first unconsumed source index", async () => {
    publicCall.mockResolvedValue(encodeUint(40n));
    loadStreamPage.mockImplementation(async (_c, _l, _o, start: bigint, stop: bigint) => {
      const streams = [];
      for (let index = start; index < stop; index++) streams.push(view(index + 1n));
      return readyOutcome({ streams });
    });
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
    expect(loadStreamPage.mock.calls[0]?.[3]).toBe(0n);
    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(loadStreamPage.mock.calls.length).toBeGreaterThan(1);
    });
    expect(loadStreamPage.mock.calls[1]?.[3]).toBe(STREAM_PAGE_SIZE);
  });

  it("advances the cursor after an all-ineligible window", async () => {
    publicCall.mockResolvedValue(encodeUint(40n));
    loadStreamPage.mockImplementation(async (_c, _l, _o, start: bigint, stop: bigint) => {
      const streams = [];
      for (let index = start; index < stop; index++) {
        streams.push(view(index + 1n, { sender: TOKEN }));
      }
      return readyOutcome({ streams });
    });
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(loadStreamPage.mock.calls.length).toBeGreaterThan(1);
    });
    expect(loadStreamPage.mock.calls[1]?.[3]).toBe(STREAM_PAGE_SIZE);
    expect(result.current.data?.renderCount ?? 0).toBe(0);
  });

  it("fails closed on a duplicate id instead of Set-merging", async () => {
    publicCall.mockResolvedValue(encodeUint(2n));
    loadStreamPage.mockResolvedValue(readyOutcome({ streams: [view(5n), view(5n)] }));
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("unavailable");
    });
    expect(result.current.data?.streams.map((row) => row.streamId)).toEqual([5n, 5n]);
    expect(result.current.failures.some((failure) => failure.code === "incomplete")).toBe(true);
  });

  it("keeps attached rows when a page is unavailable", async () => {
    publicCall.mockResolvedValue(encodeUint(1n));
    loadStreamPage.mockResolvedValue(
      unavailableOutcome(
        [readFailure("loadStreamPage", "transport", "rpc down")],
        {},
        { streams: [view(5n)] },
      ),
    );
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("unavailable");
    });
    expect(result.current.data?.streams).toHaveLength(1);
  });

  it("attaches no book to an unavailable outcome when zero rows survived", async () => {
    publicCall.mockResolvedValue(encodeUint(1n));
    loadStreamPage.mockResolvedValue(
      unavailableOutcome(
        [readFailure("loadStreamPage", "transport", "rpc down")],
        {},
        { streams: [] },
      ),
    );
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("unavailable");
    });
    expect(result.current.data).toBeUndefined();
  });

  it("hides empty streams from the lens", async () => {
    loadStreamPage.mockResolvedValue(
      readyOutcome({
        streams: [view(5n, { deposited: MIN_STREAM_AMOUNT * 2n, withdrawn: MIN_STREAM_AMOUNT * 2n })],
      }),
    );
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(0);
  });

  it("re-pins on unknown_block and fetches page one under the new hash", async () => {
    publicCall.mockResolvedValue(encodeUint(40n));
    loadStreamPage
      .mockResolvedValueOnce(readyOutcome({ streams: [view(5n)] }))
      .mockResolvedValueOnce(
        unavailableOutcome([readFailure("loadStreamPage", "transport", "unknown block")]),
      )
      .mockResolvedValue(readyOutcome({ streams: [view(7n)] }));
    const queryClient = client();
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(queryClient) });
    await waitFor(() => {
      expect(result.current.data?.streams.some((row) => row.streamId === 5n)).toBe(true);
    });
    expect(result.current.status).toBe("partial");
    expect(result.current.complete).toBe(false);
    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(pinCtl.advancePin).toHaveBeenCalled();
    });
    await waitFor(() => {
      const keys = queryClient.getQueryCache().getAll().map((entry) => entry.queryKey);
      expect(
        keys.some((key) => key[key.length - 1] === pinCtl.HASH_B.toLowerCase()),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.data?.streams.some((row) => row.streamId === 7n)).toBe(true);
    });
    const firstNew = loadStreamPage.mock.calls.find((call) => {
      const pin = call[5] as { blockHash: string } | undefined;
      return pin?.blockHash.toLowerCase() === pinCtl.HASH_B.toLowerCase();
    });
    expect(firstNew?.[3]).toBe(0n);
  });

  it("marks placeholder pages under a new hash as stale and keeps the page pin", async () => {
    publicCall.mockResolvedValue(encodeUint(1n));
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    loadStreamPage.mockImplementation(async (_c, _l, _o, _start, _stop, pin: { blockHash: string }) => {
      if (pin.blockHash.toLowerCase() === pinCtl.HASH_B.toLowerCase()) {
        await held;
        return readyOutcome({ streams: [view(9n)] });
      }
      return readyOutcome({ streams: [view(5n)] });
    });
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.freshness).toBe("fresh");
    expect(result.current.metadata.blockHash?.toLowerCase()).toBe(pinCtl.HASH_A.toLowerCase());
    pinCtl.set({ blockNumber: 11n, blockHash: pinCtl.HASH_B });
    await waitFor(() => {
      expect(result.current.status).toBe("partial");
      if (result.current.status !== "partial") throw new Error("expected partial");
      expect(result.current.freshness).toBe("stale");
    });
    expect(result.current.data?.streams[0]?.streamId).toBe(5n);
    expect(result.current.metadata.blockHash?.toLowerCase()).toBe(pinCtl.HASH_A.toLowerCase());
    release?.();
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
      if (result.current.status !== "ready") throw new Error("expected ready");
      expect(result.current.freshness).toBe("fresh");
    });
    expect(result.current.data?.streams[0]?.streamId).toBe(9n);
    expect(result.current.metadata.blockHash?.toLowerCase()).toBe(pinCtl.HASH_B.toLowerCase());
  });

  it("auto-fetches at most four all-ineligible pages then waits for LOAD MORE", async () => {
    const pages = AUTO_INELIGIBLE_PAGE_CAP + 2;
    publicCall.mockResolvedValue(encodeUint(STREAM_PAGE_SIZE * BigInt(pages)));
    loadStreamPage.mockImplementation(async (_c, _l, _o, start: bigint, stop: bigint) => {
      const streams = [];
      for (let index = start; index < stop; index++) {
        streams.push(view(index + 1n, { sender: TOKEN }));
      }
      return readyOutcome({ streams });
    });
    const { result } = renderHook(() => useStreams(input), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(loadStreamPage.mock.calls.length).toBe(1 + AUTO_INELIGIBLE_PAGE_CAP);
    });
    expect(result.current.hasNextPage).toBe(true);
    expect(loadStreamPage.mock.calls.length).toBe(1 + AUTO_INELIGIBLE_PAGE_CAP);
  });
});
