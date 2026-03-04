"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { erc20Abi } from "@/lib/contracts";

const DEFAULT_DECIMALS = 18;

export function useTokenDecimals(
  tokens: (`0x${string}` | undefined)[]
): Map<string, number> {
  const validTokens = useMemo(
    () =>
      tokens.filter((t): t is `0x${string}` => !!t).map((t) => t.toLowerCase() as `0x${string}`),
    [tokens]
  );

  const uniqueTokens = useMemo(
    () => [...new Set(validTokens)],
    [validTokens]
  );

  const contracts = useMemo(
    () =>
      uniqueTokens.map((addr) => ({
        address: addr,
        abi: erc20Abi,
        functionName: "decimals" as const,
      })),
    [uniqueTokens]
  );

  const { data } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 30 * 60 * 1000 },
  });

  return useMemo(() => {
    const map = new Map<string, number>();
    uniqueTokens.forEach((addr, i) => {
      const result = data?.[i]?.result;
      map.set(addr, typeof result === "number" ? result : DEFAULT_DECIMALS);
    });
    return map;
  }, [uniqueTokens, data]);
}

export function getDecimals(
  map: Map<string, number>,
  addr: `0x${string}` | undefined
): number {
  if (!addr) return DEFAULT_DECIMALS;
  return map.get(addr.toLowerCase()) ?? DEFAULT_DECIMALS;
}
