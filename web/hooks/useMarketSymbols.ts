"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis";
import { formatAddress } from "@/lib/format";
import type { MarketInfo } from "@/lib/types";

// Lowercase-address -> symbol map. Resolve through symbolFor so lookups never
// depend on address casing.
export type SymbolMap = Record<string, string>;

export function symbolFor(symbols: SymbolMap, address: Address): string {
  return symbols[address.toLowerCase()] ?? formatAddress(address);
}

// One batched symbol() read for every market's ovrfloToken and underlying (deduped),
// called once at the watch root and threaded down as a prop (plan KTD7). PT symbols are
// deliberately not read — PT rows already render with underlying context.
export function useMarketSymbols(markets: MarketInfo[]): SymbolMap {
  const addresses = useMemo(() => {
    const deduped = new Map<string, Address>();
    for (const market of markets) {
      deduped.set(market.ovrfloToken.toLowerCase(), market.ovrfloToken);
      deduped.set(market.underlying.toLowerCase(), market.underlying);
    }
    return [...deduped.values()];
  }, [markets]);

  const reads = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: erc20Abi,
      functionName: "symbol" as const,
    })),
    query: { enabled: addresses.length > 0 },
  });

  return useMemo(() => {
    const map: SymbolMap = {};
    addresses.forEach((address, index) => {
      const result = reads.data?.[index];
      map[address.toLowerCase()] =
        result?.status === "success" ? (result.result as string) : formatAddress(address);
    });
    return map;
  }, [addresses, reads.data]);
}
