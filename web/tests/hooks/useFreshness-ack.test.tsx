import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { readyOutcome, unavailableOutcome, readFailure } from "@/lib/read-outcome";

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: ["0x00000000000000000000000000000000000000a1" as Address],
    chainId: 1,
    status: "connected",
  }),
  useBlock: () => ({ data: { timestamp: 1_700_000_000n } }),
}));

vi.mock("@/hooks/useClock", () => ({
  useClock: () => ({ localNow: 1_700_000_010n, skew: 10n, adjustedNow: 1_700_000_000n }),
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
});
