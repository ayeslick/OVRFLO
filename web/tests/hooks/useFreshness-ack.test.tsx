import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { FRESHNESS_MAX_AGE_MS, sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { readyOutcome, unavailableOutcome, readFailure } from "@/lib/read-outcome";

const clockFx = vi.hoisted(() => ({ adjustedNow: 1_700_000_000n }));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: ["0x00000000000000000000000000000000000000a1" as Address],
    chainId: 1,
    status: "connected",
  }),
  useBlock: () => ({ data: { timestamp: 1_700_000_000n } }),
}));

vi.mock("@/hooks/useClock", () => ({
  useClock: () => ({
    localNow: clockFx.adjustedNow + 10n,
    skew: 10n,
    adjustedNow: clockFx.adjustedNow,
  }),
}));

describe("useAcknowledgment", () => {
  it("starts unacknowledged and records after acknowledge()", async () => {
    const { result } = renderHook(() => useAcknowledgment());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.acknowledged).toBe(false);
    act(() => result.current.acknowledge());
    expect(result.current.acknowledged).toBe(true);
  });
});

describe("useFreshness", () => {
  beforeEach(() => {
    clockFx.adjustedNow = 1_700_000_000n;
  });

  it("marks successful reads as synced and failed reads without history as unavailable", () => {
    const synced = renderHook(() =>
      useFreshness([sourceFromOutcome(readyOutcome({ ok: true }))]),
    );
    expect(synced.result.current.freshness.kind).toBe("synced");
    expect(synced.result.current.signingAllowed).toBe(true);

    const down = renderHook(() =>
      useFreshness([
        sourceFromOutcome(unavailableOutcome([readFailure("test", "transport", "down")])),
      ]),
    );
    expect(down.result.current.freshness.kind).toBe("unavailable");
    expect(down.result.current.signingAllowed).toBe(false);
  });

  it("keeps signingAllowed when a wagmi stamp stays inside FRESHNESS_MAX_AGE_MS", () => {
    const startMs = Number(clockFx.adjustedNow) * 1000;
    const { rerender, result } = renderHook(
      ({ updatedAt }: { updatedAt: number }) =>
        useFreshness([sourceFromOutcome(readyOutcome({ ok: true }, { dataUpdatedAt: updatedAt }))]),
      { initialProps: { updatedAt: startMs } },
    );
    expect(result.current.signingAllowed).toBe(true);

    const elapsedMs = FRESHNESS_MAX_AGE_MS + 1_000;
    clockFx.adjustedNow += BigInt(elapsedMs / 1000);
    rerender({ updatedAt: Number(clockFx.adjustedNow) * 1000 });
    expect(result.current.signingAllowed).toBe(true);
  });

  it("does not keep signingAllowed on a clock-only first stamp past FRESHNESS_MAX_AGE_MS", () => {
    const { rerender, result } = renderHook(() =>
      useFreshness([sourceFromOutcome(readyOutcome({ ok: true }))]),
    );
    expect(result.current.signingAllowed).toBe(true);

    clockFx.adjustedNow += BigInt(FRESHNESS_MAX_AGE_MS / 1000) + 1n;
    rerender();
    expect(result.current.signingAllowed).toBe(false);
  });
});
