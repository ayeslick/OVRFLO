"use client";

import type { Address } from "viem";
import { MAX_VAULT_REGISTRY_ENTRIES } from "@/lib/discovery/limits";
import type { VaultInfo } from "@/lib/types";
import { useProtocolBootstrap } from "./useProtocolBootstrap";

/**
 * Vault registry view over factory bootstrap. Loading never collapses to an
 * empty ready list; [] vaults means empty only when bootstrap status is ready.
 */
export function useOvrflos(_factory?: Address) {
  void _factory;
  const bootstrap = useProtocolBootstrap();

  if (bootstrap.status === "loading") {
    return {
      vaults: [] as VaultInfo[],
      stream: null as Address | null,
      tooLarge: false,
      isLoading: true,
      error: null as Error | null,
      bootstrap,
    };
  }

  if (bootstrap.status === "unavailable") {
    const budget = bootstrap.failures.some((failure) => failure.code === "budget_exceeded");
    const message = bootstrap.failures.map((failure) => failure.message).join("; ");
    return {
      vaults: [] as VaultInfo[],
      stream: null as Address | null,
      tooLarge: budget,
      isLoading: false,
      error: new Error(message || "Protocol bootstrap unavailable"),
      bootstrap,
    };
  }

  return {
    vaults: bootstrap.vaults,
    stream: bootstrap.stream,
    tooLarge: false,
    isLoading: false,
    error: null as Error | null,
    bootstrap,
  };
}

// A valid-history budget, not a truncation cap. Counts beyond this fail closed
// with no partial registry; 2,048 successful deployments exceed the R39
// attacker-cost floor while leaving the 24-vault performance fixture ample room.
export const MAX_VAULT_ENUMERATION = BigInt(MAX_VAULT_REGISTRY_ENTRIES);

export function bigintToSafeLength(value: bigint) {
  if (value > MAX_VAULT_ENUMERATION) return 0;
  return Number(value);
}
