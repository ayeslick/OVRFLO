import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useClock,
  useClockHydrationSafe,
  clockIsArmed,
  clockSubscriberCount,
  emitClockForTests,
  resetClockStoreForTests,
} from "@/hooks/useClock";
import { useNowSecondsHydrationSafe } from "@/hooks/useNowSeconds";

vi.mock("wagmi", () => ({
  useBlock: () => ({ data: { timestamp: 1_700_000_000n }, isSuccess: true, isError: false }),
}));

describe("useClock", () => {
  afterEach(() => resetClockStoreForTests());

  it("eager variant returns a value immediately", () => {
    const { result, unmount } = renderHook(() => useClock());
    expect(result.current.localNow).toBeGreaterThan(0n);
    unmount();
  });

  it("hydration-safe variant is null at the 0n sentinel then a value after the first tick", () => {
    resetClockStoreForTests();
    const { result, rerender } = renderHook(() => useClockHydrationSafe());
    emitClockForTests(0n);
    rerender();
    expect(result.current).toBeNull();
    expect(renderHook(() => useNowSecondsHydrationSafe()).result.current).toBeNull();
    emitClockForTests(1_700_000_000n);
    rerender();
    expect(result.current?.localNow).toBe(1_700_000_000n);
  });

  it("StrictMode double-invocation leaves one armed interval", () => {
    const { unmount } = renderHook(() => useClock(), { reactStrictMode: true });
    expect(clockIsArmed()).toBe(true);
    expect(clockSubscriberCount()).toBeGreaterThanOrEqual(1);
    unmount();
    expect(clockSubscriberCount()).toBe(0);
    expect(clockIsArmed()).toBe(false);
  });
});
