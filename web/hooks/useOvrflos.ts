"use client";

import type { Address } from "viem";
import { MAX_VAULT_REGISTRY_ENTRIES } from "@/lib/discovery/limits";
import type {
  ProtocolBootstrap,
  ReadyProtocolBootstrap,
} from "@/lib/protocol-bootstrap";
import type { VaultInfo } from "@/lib/types";
import { useProtocolBootstrap } from "./useProtocolBootstrap";

export type OvrflosResult =
  | {
      status: "loading";
      bootstrap: Extract<ProtocolBootstrap, { status: "loading" }>;
      isLoading: true;
      tooLarge: false;
      error: null;
    }
  | {
      status: "unavailable";
      bootstrap: Extract<ProtocolBootstrap, { status: "unavailable" }>;
      isLoading: false;
      tooLarge: boolean;
      error: Error;
    }
  | {
      status: "ready";
      bootstrap: ReadyProtocolBootstrap;
      vaults: readonly VaultInfo[];
      stream: Address;
      isLoading: false;
      tooLarge: false;
      error: null;
    };

/**
 * Vault registry view over factory bootstrap. vaults/stream exist only in
 * ready — consumers branch on status so loading never collapses to empty.
 */
export function useOvrflos(_factory?: Address): OvrflosResult {
  void _factory;
  const bootstrap = useProtocolBootstrap();

  if (bootstrap.status === "loading") {
    return {
      status: "loading",
      bootstrap,
      isLoading: true,
      tooLarge: false,
      error: null,
    };
  }

  if (bootstrap.status === "unavailable") {
    const budget = bootstrap.failures.some((failure) => failure.code === "budget_exceeded");
    const message = bootstrap.failures.map((failure) => failure.message).join("; ");
    return {
      status: "unavailable",
      bootstrap,
      isLoading: false,
      tooLarge: budget,
      error: new Error(message || "Protocol bootstrap unavailable"),
    };
  }

  return {
    status: "ready",
    bootstrap,
    vaults: bootstrap.vaults,
    stream: bootstrap.stream,
    isLoading: false,
    tooLarge: false,
    error: null,
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
