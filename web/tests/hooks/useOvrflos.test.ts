import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { bigintToSafeLength, useOvrflos } from "@/hooks/useOvrflos";
import { ZERO_ADDRESS } from "@/lib/config";

const FACTORY = "0x0000000000000000000000000000000000000f00" as Address;
const VAULT_A = "0x0000000000000000000000000000000000000a01" as Address;
const VAULT_B = "0x0000000000000000000000000000000000000a02" as Address;
const TREASURY = "0x0000000000000000000000000000000000000701" as Address;
const UNDERLYING = "0x0000000000000000000000000000000000000702" as Address;
const OVRFLO_TOKEN = "0x0000000000000000000000000000000000000703" as Address;
const LENDING = "0x0000000000000000000000000000000000000704" as Address;

const success = (result: unknown) => ({ status: "success" as const, result });

let countReturn: { data?: bigint; isLoading: boolean; error: unknown };
let vaultsReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
let infoReturn: { data?: unknown[]; isLoading: boolean; error: unknown };

// useOvrflos calls useReadContracts exactly twice, in a fixed order (vault
// addresses, then per-vault info) — call order is a more robust discriminator
// than functionName, since the vault-addresses call can have an empty
// contracts array (count===0n) with no functionName to inspect.
let readContractsCallCount = 0;

vi.mock("wagmi", () => ({
  useReadContract: () => countReturn,
  useReadContracts: () => {
    readContractsCallCount += 1;
    return readContractsCallCount % 2 === 1 ? vaultsReturn : infoReturn;
  },
}));

describe("bigintToSafeLength", () => {
  it("fails a count beyond the validity budget instead of returning a partial prefix", () => {
    expect(bigintToSafeLength(3n)).toBe(3);
    expect(bigintToSafeLength(0n)).toBe(0);
    expect(bigintToSafeLength(1_000_000n)).toBe(0);
  });
});

describe("useOvrflos", () => {
  beforeEach(() => {
    readContractsCallCount = 0;
  });

  it("assembles vault info by pairing ovrfloInfo and ovrfloToLending per vault, in order", () => {
    countReturn = { data: 2n, isLoading: false, error: null };
    vaultsReturn = { data: [success(VAULT_A), success(VAULT_B)], isLoading: false, error: null };
    infoReturn = {
      data: [
        success([TREASURY, UNDERLYING, OVRFLO_TOKEN]),
        success(LENDING),
        success([TREASURY, UNDERLYING, OVRFLO_TOKEN]),
        success(ZERO_ADDRESS),
      ],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.vaults).toHaveLength(2);
    expect(result.current.vaults[0]).toEqual({
      vault: VAULT_A,
      treasury: TREASURY,
      underlying: UNDERLYING,
      ovrfloToken: OVRFLO_TOKEN,
      lending: LENDING,
    });
    // Vault B has no lending market deployed yet: ovrfloToLending returns the
    // zero address, which must surface as null, not as a truthy zero address.
    expect(result.current.vaults[1].lending).toBeNull();
  });

  it("drops zero-address vault slots (unfilled factory registry entries)", () => {
    countReturn = { data: 2n, isLoading: false, error: null };
    vaultsReturn = { data: [success(ZERO_ADDRESS), success(VAULT_A)], isLoading: false, error: null };
    infoReturn = {
      data: [success([TREASURY, UNDERLYING, OVRFLO_TOKEN]), success(LENDING)],
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.vaults).toHaveLength(1);
    expect(result.current.vaults[0].vault).toBe(VAULT_A);
  });

  it("returns an empty vault list and is loading when the count read has not resolved yet", () => {
    countReturn = { data: undefined, isLoading: true, error: null };
    vaultsReturn = { data: undefined, isLoading: false, error: null };
    infoReturn = { data: undefined, isLoading: false, error: null };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.vaults).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("is loading while the vault-addresses read is in flight", () => {
    countReturn = { data: 1n, isLoading: false, error: null };
    vaultsReturn = { data: undefined, isLoading: true, error: null };
    infoReturn = { data: undefined, isLoading: false, error: null };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.isLoading).toBe(true);
  });

  it("is loading while the per-vault info read is in flight", () => {
    countReturn = { data: 1n, isLoading: false, error: null };
    vaultsReturn = { data: [success(VAULT_A)], isLoading: false, error: null };
    infoReturn = { data: undefined, isLoading: true, error: null };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.isLoading).toBe(true);
  });

  // Split by source rather than one "any of the three" test asserting only
  // one of them, so a regression that drops any single operand from either
  // chained `||`/`??` in useOvrflos.ts is caught regardless of which one.
  it("propagates an error from the vault count read", () => {
    const error = new Error("count rpc down");
    countReturn = { data: undefined, isLoading: false, error };
    vaultsReturn = { data: undefined, isLoading: false, error: null };
    infoReturn = { data: undefined, isLoading: false, error: null };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.error).toBe(error);
  });

  it("propagates an error from the vault-addresses read", () => {
    const error = new Error("vaults rpc down");
    countReturn = { data: 0n, isLoading: false, error: null };
    vaultsReturn = { data: [], isLoading: false, error };
    infoReturn = { data: [], isLoading: false, error: null };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.error).toBe(error);
  });

  it("propagates an error from the per-vault info read", () => {
    const error = new Error("info rpc down");
    countReturn = { data: 1n, isLoading: false, error: null };
    vaultsReturn = { data: [success(VAULT_A)], isLoading: false, error: null };
    infoReturn = { data: undefined, isLoading: false, error };

    const { result } = renderHook(() => useOvrflos(FACTORY));
    expect(result.current.error).toBe(error);
  });
});
