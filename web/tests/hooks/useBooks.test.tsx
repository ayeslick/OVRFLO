import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLenderBook } from "@/hooks/useLenderBook";
import { useBorrowerBook } from "@/hooks/useBorrowerBook";
import { useLadder } from "@/hooks/useLadder";
import { readyOutcome, partialOutcome, readFailure } from "@/lib/read-outcome";

const LENDING = "0x0000000000000000000000000000000000000a11" as Address;
const MARKET = "0x0000000000000000000000000000000000000b22" as Address;
const USER = "0x0000000000000000000000000000000000000c33" as Address;
const success = (result: unknown) => ({ status: "success" as const, result });

let lendingConfigReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
let depthReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
const emptyBatch = { data: [] as unknown[], isLoading: false, error: null, dataUpdatedAt: 0 };

const { loadFactoryLenderPage, loadFactoryBorrowerPage } = vi.hoisted(() => ({
  loadFactoryLenderPage: vi.fn(),
  loadFactoryBorrowerPage: vi.fn(),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ readContract: vi.fn() }),
  useReadContracts: (config: { contracts?: { functionName?: string }[] }) => {
    const name = config.contracts?.[0]?.functionName;
    if (name === "UNIT") return lendingConfigReturn;
    if (name === "tickDepths") return depthReturn;
    return emptyBatch;
  },
}));

vi.mock("@/lib/protocol/lending", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol/lending")>();
  return { ...actual, loadFactoryLenderPage, loadFactoryBorrowerPage };
});

function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("book hooks", () => {
  beforeEach(() => {
    loadFactoryLenderPage.mockReset();
    loadFactoryBorrowerPage.mockReset();
    loadFactoryLenderPage.mockResolvedValue(readyOutcome({ positions: [], sourceCount: 0n }));
    loadFactoryBorrowerPage.mockResolvedValue(readyOutcome({ loans: [], sourceCount: 0n }));
  });

  it("lender book at zero entities is confirmed-empty, not unavailable", async () => {
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.positions).toEqual([]);
    expect(result.current.data.confirmedEmpty).toBe(true);
    expect(result.current.data.complete).toBe(true);
  });

  it("borrower book at zero entities is confirmed-empty, not unavailable", async () => {
    const { result } = renderHook(() => useBorrowerBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.loans).toEqual([]);
    expect(result.current.data.confirmedEmpty).toBe(true);
  });

  it("stamps TanStack dataUpdatedAt on a ready borrower book", async () => {
    const { result } = renderHook(() => useBorrowerBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.metadata.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("stamps TanStack dataUpdatedAt on a ready lender book", async () => {
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.metadata.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("lender book classifies a failed count as unavailable, never zero (AE1)", async () => {
    loadFactoryLenderPage.mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    await waitFor(
      () => {
        expect(result.current.status).toBe("unavailable");
      },
      { timeout: 5_000 },
    );
    expect(result.current.data).toBeUndefined();
  });

  it("keeps a zero-row partial lender page as partial, not loading", async () => {
    loadFactoryLenderPage.mockResolvedValue(
      partialOutcome({ positions: [], sourceCount: 1n }, [
        readFailure("loadLenderPage", "subcall", "positionState reverted"),
      ]),
    );
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("partial");
    });
    if (result.current.status !== "partial") throw new Error("expected partial");
    expect(result.current.complete).toBe(false);
    expect(result.current.data.positions).toEqual([]);
    expect(result.current.failures[0]?.message).toMatch(/positionState/);
  });

  it("keeps a zero-row partial borrower page as partial, not loading", async () => {
    loadFactoryBorrowerPage.mockResolvedValue(
      partialOutcome({ loans: [], sourceCount: 1n }, [
        readFailure("loadBorrowerPage", "subcall", "loanState reverted"),
      ]),
    );
    const { result } = renderHook(() => useBorrowerBook(LENDING, USER), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("partial");
    });
    if (result.current.status !== "partial") throw new Error("expected partial");
    expect(result.current.complete).toBe(false);
    expect(result.current.data.loans).toEqual([]);
    expect(result.current.failures[0]?.message).toMatch(/loanState/);
  });

  it("does not treat an empty lending list as a first-run zero while markets load", () => {
    const { result } = renderHook(() => useLenderBook([], USER, { enabled: false }), { wrapper });
    expect(result.current.status).toBe("loading");
  });
});

describe("useLadder", () => {
  it("shapes mocked tickDepths into a ladder model", () => {
    lendingConfigReturn = {
      data: [
        success(10n ** 12n),
        success(10n ** 15n),
        success(10n ** 6n),
        success(40),
        success(1000),
        success(2000),
      ],
      isLoading: false,
      error: null,
    };
    depthReturn = {
      data: [success([{ aprBps: 1000, availableUnits: 5_000n }]), success(25)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLadder(LENDING, MARKET), { wrapper });
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.model.rungs).toHaveLength(1);
    expect(result.current.data.tickSpacing).toBe(25);
  });
});
