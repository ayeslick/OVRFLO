import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import type { BorrowErrorKind } from "@/lib/borrow";

const user = "0x0000000000000000000000000000000000000a11" as Address;

function classify(kind: BorrowErrorKind) {
  return () => kind;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useStaleRecovery", () => {
  it("reports no error kind and no recovery when there is no error", () => {
    const queryClient = new QueryClient();
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStaleRecovery(null, classify("retryable"), queryClient, user), {
      wrapper: wrap,
    });
    expect(result.current.errorKind).toBeNull();
    expect(result.current.terminal).toBe(false);
    expect(result.current.staleRecovery).toBe(false);
  });

  it("flips staleRecovery and invalidates every on-chain read for a stale error", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useStaleRecovery(new Error("stale"), classify("stale"), queryClient, user),
      { wrapper: wrap },
    );
    expect(result.current.errorKind).toBe("stale");
    expect(result.current.staleRecovery).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("reports terminal for a terminal error without triggering the invalidate reaction", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useStaleRecovery(new Error("terminal"), classify("terminal"), queryClient, user),
      { wrapper },
    );
    expect(result.current.terminal).toBe(true);
    expect(result.current.staleRecovery).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("exposes setStaleRecovery so callers can clear it on their own triggers", () => {
    const queryClient = new QueryClient();
    const staleError = new Error("stale");
    const { result } = renderHook(() => useStaleRecovery(staleError, classify("stale"), queryClient, user), {
      wrapper,
    });
    expect(result.current.staleRecovery).toBe(true);
    act(() => result.current.setStaleRecovery(false));
    expect(result.current.staleRecovery).toBe(false);
  });
});
