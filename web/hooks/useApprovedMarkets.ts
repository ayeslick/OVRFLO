"use client";

import { useReadContracts } from "wagmi";
import { OVRFLO_FACTORY } from "@/lib/constants";
import { ovrfloFactoryAbi, ovrfloAbi } from "@/lib/contracts";

export interface MarketInfo {
  market: `0x${string}`;
  ovrflo: `0x${string}`;
  approved: boolean;
  twapDuration: number;
  feeBps: number;
  expiry: bigint;
  ptToken: `0x${string}`;
  ovrfloToken: `0x${string}`;
  underlying: `0x${string}`;
}

export function useMarketCount(ovrflo: `0x${string}` | undefined) {
  return useReadContracts({
    contracts: ovrflo
      ? [
          {
            address: OVRFLO_FACTORY as `0x${string}`,
            abi: ovrfloFactoryAbi,
            functionName: "approvedMarketCount",
            args: [ovrflo],
          },
        ]
      : [],
    query: { enabled: !!ovrflo },
  });
}

export function useMarketAddresses(
  ovrflo: `0x${string}` | undefined,
  count: number
) {
  const contracts =
    ovrflo && count > 0
      ? Array.from({ length: count }, (_, i) => ({
          address: OVRFLO_FACTORY as `0x${string}`,
          abi: ovrfloFactoryAbi,
          functionName: "getApprovedMarket" as const,
          args: [ovrflo, BigInt(i)] as const,
        }))
      : [];

  return useReadContracts({ contracts, query: { enabled: contracts.length > 0 } });
}

export function useMarketSeries(
  ovrflo: `0x${string}` | undefined,
  markets: `0x${string}`[]
) {
  const contracts =
    ovrflo && markets.length > 0
      ? markets.map((m) => ({
          address: ovrflo,
          abi: ovrfloAbi,
          functionName: "series" as const,
          args: [m] as const,
        }))
      : [];

  return useReadContracts({ contracts, query: { enabled: contracts.length > 0 } });
}
