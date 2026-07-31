"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloFactoryAbi } from "@/lib/abis";
import { factoryAddress, isConfiguredAddress, ZERO_ADDRESS } from "@/lib/config";
import { MAX_VAULT_REGISTRY_ENTRIES } from "@/lib/discovery/limits";
import type { VaultInfo } from "@/lib/types";

export function useOvrflos(factory: Address = factoryAddress) {
  const countRead = useReadContract({
    address: factory,
    abi: ovrfloFactoryAbi,
    functionName: "ovrfloCount",
    query: { enabled: isConfiguredAddress(factory) },
  });

  const count = countRead.data ?? 0n;
  const indexes = useMemo(
    () => Array.from({ length: bigintToSafeLength(count) }, (_, index) => BigInt(index)),
    [count],
  );

  const vaultReads = useReadContracts({
    contracts: indexes.map((index) => ({
      address: factory,
      abi: ovrfloFactoryAbi,
      functionName: "ovrflos",
      args: [index],
    })),
    query: { enabled: indexes.length > 0 },
  });

  const vaultAddresses = useMemo(
    () =>
      (vaultReads.data ?? [])
        .map((result) => (result.status === "success" ? result.result : undefined))
        .filter((address): address is Address => Boolean(address && address !== ZERO_ADDRESS)),
    [vaultReads.data],
  );

  const infoReads = useReadContracts({
    contracts: vaultAddresses.flatMap((vault) => [
      {
        address: factory,
        abi: ovrfloFactoryAbi,
        functionName: "ovrfloInfo",
        args: [vault],
      },
      {
        address: factory,
        abi: ovrfloFactoryAbi,
        functionName: "ovrfloToLending",
        args: [vault],
      },
    ]),
    query: { enabled: vaultAddresses.length > 0 },
  });

  const vaults = useMemo<VaultInfo[]>(() => {
    const results = infoReads.data ?? [];
    return vaultAddresses.map((vault, index) => {
      const info = results[index * 2];
      const lending = results[index * 2 + 1];
      const tuple = info?.status === "success" ? (info.result as unknown as readonly [Address, Address, Address]) : undefined;
      const lendingAddress = lending?.status === "success" ? (lending.result as Address) : ZERO_ADDRESS;
      return {
        vault,
        treasury: tuple?.[0] ?? ZERO_ADDRESS,
        underlying: tuple?.[1] ?? ZERO_ADDRESS,
        ovrfloToken: tuple?.[2] ?? ZERO_ADDRESS,
        lending: lendingAddress && lendingAddress !== ZERO_ADDRESS ? lendingAddress : null,
      };
    });
  }, [infoReads.data, vaultAddresses]);
  const incomplete =
    count <= MAX_VAULT_ENUMERATION &&
    ((indexes.length > 0 &&
      (vaultReads.data?.length !== indexes.length ||
        vaultReads.data.some((result) => result.status !== "success"))) ||
      (vaultAddresses.length > 0 &&
        (infoReads.data?.length !== vaultAddresses.length * 2 ||
          infoReads.data.some((result) => result.status !== "success"))));

  return {
    vaults: incomplete ? [] : vaults,
    tooLarge: count > MAX_VAULT_ENUMERATION,
    isLoading: countRead.isLoading || vaultReads.isLoading || infoReads.isLoading,
    error:
      countRead.error ??
      vaultReads.error ??
      infoReads.error ??
      (incomplete ? new Error("Vault registry hydration is incomplete") : null),
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
