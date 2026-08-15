import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLenderBook } from "@/hooks/useLenderBook";
import { useBorrowerBook } from "@/hooks/useBorrowerBook";
import { useLadder } from "@/hooks/useLadder";

const LENDING = "0x0000000000000000000000000000000000000a11" as Address;
const MARKET = "0x0000000000000000000000000000000000000b22" as Address;
const USER = "0x0000000000000000000000000000000000000c33" as Address;
const success = (result: unknown) => ({ status: "success" as const, result });

let countReturn: {
  data?: bigint;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  dataUpdatedAt?: number;
};
let lendingConfigReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
let depthReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
const emptyBatch = { data: [] as unknown[], isLoading: false, error: null, dataUpdatedAt: 0 };

vi.mock("wagmi", () => ({
  usePublicClient: () => null,
  useReadContract: () => countReturn,
  useReadContracts: (config: { contracts?: { functionName?: string }[] }) => {
    const name = config.contracts?.[0]?.functionName;
    if (name === "UNIT") return lendingConfigReturn;
    if (name === "tickDepths") return depthReturn;
    return emptyBatch;
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("book hooks", () => {
  it("lender book at zero entities is confirmed-empty, not unavailable", () => {
    countReturn = { data: 0n, isLoading: false, isError: false, isSuccess: true, error: null };
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.positions).toEqual([]);
  });

  it("borrower book at zero entities is confirmed-empty, not unavailable", () => {
    countReturn = { data: 0n, isLoading: false, isError: false, isSuccess: true, error: null };
    const { result } = renderHook(() => useBorrowerBook(LENDING, USER), { wrapper });
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.loans).toEqual([]);
  });

  it("stamps wagmi dataUpdatedAt on a ready borrower book", () => {
    countReturn = {
      data: 0n,
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      dataUpdatedAt: 1_700_000_000_000,
    };
    const { result } = renderHook(() => useBorrowerBook(LENDING, USER), { wrapper });
    expect(result.current.status).toBe("ready");
    expect(result.current.metadata.dataUpdatedAt).toBe(1_700_000_000_000);
  });

  it("stamps wagmi dataUpdatedAt on a ready lender book", () => {
    countReturn = {
      data: 0n,
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      dataUpdatedAt: 1_700_000_000_500,
    };
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    expect(result.current.status).toBe("ready");
    expect(result.current.metadata.dataUpdatedAt).toBe(1_700_000_000_500);
  });

  it("lender book classifies a failed count as unavailable, never zero (AE1)", () => {
    countReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error("rpc down"),
    };
    const { result } = renderHook(() => useLenderBook(LENDING, USER), { wrapper });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.data).toBeUndefined();
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
