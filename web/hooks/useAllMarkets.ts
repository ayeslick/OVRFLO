"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { OVRFLO_FACTORY } from "@/lib/constants";
import { ovrfloFactoryAbi, ovrfloAbi } from "@/lib/contracts";
import type { OvrfloEntry } from "./useOvrflos";

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

export function useAllMarkets(ovrflos: OvrfloEntry[]): {
  markets: MarketInfo[];
  isLoading: boolean;
} {
  // Step 1: Batch all market-count reads into one useReadContracts call.
  const countContracts = useMemo(
    () =>
      ovrflos.map((o) => ({
        address: OVRFLO_FACTORY as `0x${string}`,
        abi: ovrfloFactoryAbi,
        functionName: "approvedMarketCount" as const,
        args: [o.address] as const,
      })),
    [ovrflos]
  );

  const {
    data: countResults,
    isLoading: countsLoading,
  } = useReadContracts({
    contracts: countContracts,
    query: { enabled: countContracts.length > 0 },
  });

  // Step 2: From counts, build a flat list of address-fetch contracts.
  const { addressContracts, countPerOvrflo } = useMemo(() => {
    if (!countResults) return { addressContracts: [], countPerOvrflo: [] as number[] };
    const counts: number[] = [];
    const contracts: {
      address: `0x${string}`;
      abi: typeof ovrfloFactoryAbi;
      functionName: "getApprovedMarket";
      args: readonly [`0x${string}`, bigint];
    }[] = [];
    ovrflos.forEach((o, oi) => {
      const count = countResults[oi]?.result ? Number(countResults[oi].result) : 0;
      counts.push(count);
      for (let i = 0; i < count; i++) {
        contracts.push({
          address: OVRFLO_FACTORY as `0x${string}`,
          abi: ovrfloFactoryAbi,
          functionName: "getApprovedMarket" as const,
          args: [o.address, BigInt(i)] as const,
        });
      }
    });
    return { addressContracts: contracts, countPerOvrflo: counts };
  }, [ovrflos, countResults]);

  const {
    data: addrResults,
    isLoading: addrsLoading,
  } = useReadContracts({
    contracts: addressContracts,
    query: { enabled: addressContracts.length > 0 },
  });

  // Step 3: From addresses, build series-fetch contracts.
  const seriesContracts = useMemo(() => {
    if (!addrResults || addrResults.length === 0) return [];
    let idx = 0;
    const contracts: {
      address: `0x${string}`;
      abi: typeof ovrfloAbi;
      functionName: "series";
      args: readonly [`0x${string}`];
    }[] = [];
    ovrflos.forEach((o, oi) => {
      const count = countPerOvrflo[oi] ?? 0;
      for (let i = 0; i < count; i++) {
        const market = addrResults[idx]?.result as `0x${string}` | undefined;
        if (market) {
          contracts.push({
            address: o.address,
            abi: ovrfloAbi,
            functionName: "series" as const,
            args: [market] as const,
          });
        }
        idx++;
      }
    });
    return contracts;
  }, [ovrflos, countPerOvrflo, addrResults]);

  const {
    data: seriesResults,
    isLoading: seriesLoading,
  } = useReadContracts({
    contracts: seriesContracts,
    query: { enabled: seriesContracts.length > 0 },
  });

  // Step 4: Post-process into MarketInfo[].
  const markets = useMemo(() => {
    if (!addrResults || !seriesResults) return [];
    const result: MarketInfo[] = [];
    let addrIdx = 0;
    let seriesIdx = 0;
    ovrflos.forEach((o, oi) => {
      const count = countPerOvrflo[oi] ?? 0;
      for (let i = 0; i < count; i++) {
        const market = addrResults[addrIdx]?.result as `0x${string}` | undefined;
        addrIdx++;
        if (!market) continue;
        const s = seriesResults[seriesIdx]?.result as
          | readonly [boolean, number, number, bigint, `0x${string}`, `0x${string}`, `0x${string}`]
          | undefined;
        seriesIdx++;
        if (!s) continue;
        result.push({
          market,
          ovrflo: o.address,
          approved: s[0],
          twapDuration: s[1],
          feeBps: s[2],
          expiry: s[3],
          ptToken: s[4],
          ovrfloToken: s[5],
          underlying: s[6],
        });
      }
    });
    return result;
  }, [ovrflos, countPerOvrflo, addrResults, seriesResults]);

  return {
    markets,
    isLoading: countsLoading || addrsLoading || seriesLoading,
  };
}
