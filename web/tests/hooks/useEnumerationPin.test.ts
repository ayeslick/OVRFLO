import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import type { Hash } from "viem";
import { useEnumerationPin } from "@/hooks/useEnumerationPin";

const HASH_A = `0x${"aa".repeat(32)}` as Hash;
const HASH_B = `0x${"bb".repeat(32)}` as Hash;

const { blockState, getBlock } = vi.hoisted(() => ({
  blockState: {
    data: {
      number: 10n,
      hash: `0x${"aa".repeat(32)}` as Hash,
      timestamp: 1n,
    },
    dataUpdatedAt: 1_000,
  },
  getBlock: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useBlock: () => blockState,
  usePublicClient: () => ({ getBlock }),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, rpcUrls: ["http://127.0.0.1:8545"] };
});

describe("useEnumerationPin", () => {
  beforeEach(() => {
    blockState.data = { number: 10n, hash: HASH_A, timestamp: 1n };
    getBlock.mockReset();
    getBlock.mockResolvedValue({ number: 11n, hash: HASH_B, timestamp: 2n });
  });

  it("captures the first head and advancePin puts a new hash on the pin", async () => {
    const { result } = renderHook(() => useEnumerationPin());
    await waitFor(() => {
      expect(result.current.pin?.blockHash.toLowerCase()).toBe(HASH_A.toLowerCase());
    });
    expect(result.current.stale).toBe(false);
    await act(async () => {
      await result.current.advancePin();
    });
    expect(result.current.pin?.blockHash.toLowerCase()).toBe(HASH_B.toLowerCase());
    expect(result.current.pin?.blockNumber).toBe(11n);
    expect(result.current.stale).toBe(true);
  });

  it("does not change the pin when latest head is unchanged", async () => {
    getBlock.mockResolvedValue({ number: 10n, hash: HASH_A, timestamp: 1n });
    const { result } = renderHook(() => useEnumerationPin());
    await waitFor(() => {
      expect(result.current.pin?.blockHash.toLowerCase()).toBe(HASH_A.toLowerCase());
    });
    await act(async () => {
      await result.current.advancePin();
    });
    expect(result.current.pin?.blockHash.toLowerCase()).toBe(HASH_A.toLowerCase());
    expect(result.current.stale).toBe(false);
  });
});
