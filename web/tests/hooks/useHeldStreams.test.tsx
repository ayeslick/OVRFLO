import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import {
  loadingOutcome,
  readyOutcome,
  unavailableOutcome,
  readFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";

const USER = "0x00000000000000000000000000000000000000a1" as Address;
const VAULT = "0x00000000000000000000000000000000000000b2" as Address;
const state = vi.hoisted(() => ({
  registry: {
    vaults: [{ vault: "0x00000000000000000000000000000000000000b2" as Address }],
    isLoading: false,
    error: null as Error | null,
    tooLarge: false,
  },
  projection: {
    outcome: {
      status: "loading",
      complete: false,
      failures: [],
      metadata: {},
    } as ReadOutcome<unknown>,
    isLoading: true,
    error: null as Error | null,
  },
}));

vi.mock("@/hooks/useOvrflos", () => ({
  useOvrflos: () => state.registry,
}));
vi.mock("@/hooks/useLendingProjection", () => ({
  useHeldStreamProjection: () => state.projection,
}));

describe("useHeldStreams — U9 projection adapter", () => {
  beforeEach(() => {
    state.registry = { vaults: [{ vault: VAULT }], isLoading: false, error: null, tooLarge: false };
    state.projection = { outcome: loadingOutcome(), isLoading: true, error: null };
  });

  it("returns fields hydrated directly at the projection block", () => {
    const stream = {
      streamId: 900n,
      recipient: USER,
      sender: VAULT,
      asset: VAULT,
      endTime: 2_000n,
      canceled: false,
      depleted: false,
      deposited: 10n,
      withdrawn: 2n,
      withdrawable: 3n,
    };
    state.projection = {
      outcome: readyOutcome({ streams: [stream], candidateIds: [900n], ledger: {} }),
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useHeldStreams(USER));
    expect(result.current.streams).toEqual([stream]);
    expect(result.current.unavailable).toBe(false);
  });

  it("does not turn an unavailable projection into an empty-ready list", () => {
    const error = new Error("historical RPC unavailable");
    state.projection = {
      outcome: unavailableOutcome([readFailure("streams", "transport", error)]),
      isLoading: false,
      error,
    };
    const { result } = renderHook(() => useHeldStreams(USER));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.error).toBe(error);
  });
});
