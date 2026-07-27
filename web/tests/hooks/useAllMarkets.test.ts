import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { ZERO_ADDRESS } from "@/lib/config";
import type { VaultInfo } from "@/lib/types";

const VAULT_A = "0x0000000000000000000000000000000000000a01" as Address;
const MARKET_A = "0x0000000000000000000000000000000000000ea1" as Address;
const MARKET_B = "0x0000000000000000000000000000000000000ea2" as Address;
const PT_TOKEN = "0x0000000000000000000000000000000000000701" as Address;
const OVRFLO_TOKEN = "0x0000000000000000000000000000000000000702" as Address;
const UNDERLYING = "0x0000000000000000000000000000000000000703" as Address;
const ORACLE = "0x0000000000000000000000000000000000000704" as Address;

const vault: VaultInfo = {
  vault: VAULT_A,
  treasury: "0x0000000000000000000000000000000000000705" as Address,
  underlying: UNDERLYING,
  ovrfloToken: OVRFLO_TOKEN,
  lending: null,
};

const success = (result: unknown) => ({ status: "success" as const, result });
const seriesTuple = (ptToken: Address) => [900, 40, 1_800_000_000n, ptToken, OVRFLO_TOKEN, UNDERLYING, ORACLE];

let ovrflosState: { vaults: VaultInfo[]; isLoading: boolean; error: unknown };
vi.mock("@/hooks/useOvrflos", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOvrflos")>("@/hooks/useOvrflos");
  return { ...actual, useOvrflos: () => ovrflosState };
});

// useAllMarkets calls useReadContracts exactly 3 times, in a fixed order:
// marketCountReads, marketAddressReads, seriesReads.
let readContractsCallCount = 0;
let marketCountReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
let marketAddressReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
let seriesReturn: { data?: unknown[]; isLoading: boolean; error: unknown };

vi.mock("wagmi", () => ({
  useReadContracts: () => {
    readContractsCallCount += 1;
    if (readContractsCallCount % 3 === 1) return marketCountReturn;
    if (readContractsCallCount % 3 === 2) return marketAddressReturn;
    return seriesReturn;
  },
}));

describe("useAllMarkets", () => {
  beforeEach(() => {
    readContractsCallCount = 0;
  });

  it("builds one MarketInfo row per approved market, merging vault + series data", () => {
    ovrflosState = { vaults: [vault], isLoading: false, error: null };
    marketCountReturn = { data: [success(2n)], isLoading: false, error: null };
    marketAddressReturn = { data: [success(MARKET_A), success(MARKET_B)], isLoading: false, error: null };
    seriesReturn = {
      data: [success(seriesTuple(PT_TOKEN)), success(seriesTuple(PT_TOKEN))],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useAllMarkets());
    expect(result.current.markets).toHaveLength(2);
    expect(result.current.markets[0]).toMatchObject({
      vault: VAULT_A,
      market: MARKET_A,
      ptToken: PT_TOKEN,
      feeBps: 40,
    });
    expect(result.current.markets[1].market).toBe(MARKET_B);
  });

  it("skips a series slot whose ptToken is the zero address (not yet approved/matured-cleared)", () => {
    ovrflosState = { vaults: [vault], isLoading: false, error: null };
    marketCountReturn = { data: [success(2n)], isLoading: false, error: null };
    marketAddressReturn = { data: [success(MARKET_A), success(MARKET_B)], isLoading: false, error: null };
    seriesReturn = {
      data: [success(seriesTuple(ZERO_ADDRESS)), success(seriesTuple(PT_TOKEN))],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useAllMarkets());
    expect(result.current.markets).toHaveLength(1);
    expect(result.current.markets[0].market).toBe(MARKET_B);
  });

  it("returns no markets when there are no vaults at all", () => {
    ovrflosState = { vaults: [], isLoading: false, error: null };
    marketCountReturn = { data: [], isLoading: false, error: null };
    marketAddressReturn = { data: [], isLoading: false, error: null };
    seriesReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useAllMarkets());
    expect(result.current.markets).toEqual([]);
  });

  it("propagates loading/error from the upstream useOvrflos hook", () => {
    const error = new Error("factory unreachable");
    ovrflosState = { vaults: [], isLoading: true, error };
    marketCountReturn = { data: [], isLoading: false, error: null };
    marketAddressReturn = { data: [], isLoading: false, error: null };
    seriesReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useAllMarkets());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe(error);
  });
});
