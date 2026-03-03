"use client";

import { useReadContracts } from "wagmi";
import { OVRFLO_FACTORY } from "@/lib/constants";
import { ovrfloFactoryAbi } from "@/lib/contracts";

export interface OvrfloEntry {
  address: `0x${string}`;
  treasury: `0x${string}`;
  underlying: `0x${string}`;
  ovrfloToken: `0x${string}`;
}

export function useOvrfloCount() {
  return useReadContracts({
    contracts: [
      {
        address: OVRFLO_FACTORY as `0x${string}`,
        abi: ovrfloFactoryAbi,
        functionName: "ovrfloCount",
      },
    ],
  });
}

export function useOvrfloAddresses(count: number) {
  const contracts = Array.from({ length: count }, (_, i) => ({
    address: OVRFLO_FACTORY as `0x${string}`,
    abi: ovrfloFactoryAbi,
    functionName: "ovrflos" as const,
    args: [BigInt(i)] as const,
  }));

  return useReadContracts({ contracts, query: { enabled: count > 0 } });
}

export function useOvrfloInfos(addresses: `0x${string}`[]) {
  const contracts = addresses.map((addr) => ({
    address: OVRFLO_FACTORY as `0x${string}`,
    abi: ovrfloFactoryAbi,
    functionName: "ovrfloInfo" as const,
    args: [addr] as const,
  }));

  return useReadContracts({
    contracts,
    query: { enabled: addresses.length > 0 },
  });
}
