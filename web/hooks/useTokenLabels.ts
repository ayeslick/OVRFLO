"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { erc20Abi } from "@/lib/contracts";

const FALLBACK_SYMBOL = "Token";

export function useTokenSymbols(tokens: (`0x${string}` | undefined)[]) {
  const uniqueTokens = useMemo(
    () =>
      [...new Set(tokens.filter((t): t is `0x${string}` => !!t).map((t) => t.toLowerCase() as `0x${string}`))],
    [tokens]
  );

  const contracts = useMemo(
    () =>
      uniqueTokens.map((address) => ({
        address,
        abi: erc20Abi,
        functionName: "symbol" as const,
      })),
    [uniqueTokens]
  );

  const { data } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 30 * 60 * 1000 },
  });

  return useMemo(() => {
    const symbolMap = new Map<string, string>();
    uniqueTokens.forEach((address, index) => {
      const symbol = data?.[index]?.result;
      symbolMap.set(address, typeof symbol === "string" && symbol ? symbol : FALLBACK_SYMBOL);
    });
    return symbolMap;
  }, [data, uniqueTokens]);
}

export function getTokenSymbol(
  map: Map<string, string>,
  address: `0x${string}` | undefined,
  fallback?: string
) {
  if (!address) return fallback ?? FALLBACK_SYMBOL;
  return map.get(address.toLowerCase()) ?? fallback ?? FALLBACK_SYMBOL;
}
