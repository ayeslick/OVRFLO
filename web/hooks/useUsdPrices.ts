"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

interface PriceResponse {
  nativeUsd?: number;
  tokenUsd: Map<string, number>;
}

async function fetchUsdPrices(addresses: `0x${string}`[]): Promise<PriceResponse> {
  const tokenUsd = new Map<string, number>();

  const [nativeRes, tokenRes] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"),
    addresses.length
      ? fetch(
          `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${addresses.join(",")}&vs_currencies=usd`
        )
      : Promise.resolve(undefined),
  ]);

  let nativeUsd: number | undefined;

  if (nativeRes.ok) {
    const json = (await nativeRes.json()) as { ethereum?: { usd?: number } };
    nativeUsd = json.ethereum?.usd;
  }

  if (tokenRes && tokenRes.ok) {
    const json = (await tokenRes.json()) as Record<string, { usd?: number }>;
    Object.entries(json).forEach(([address, price]) => {
      if (typeof price.usd === "number") {
        tokenUsd.set(address.toLowerCase(), price.usd);
      }
    });
  }

  return { nativeUsd, tokenUsd };
}

export function useUsdPrices(tokens: (`0x${string}` | undefined)[]) {
  const uniqueTokens = useMemo(
    () =>
      [...new Set(tokens.filter((t): t is `0x${string}` => !!t).map((t) => t.toLowerCase() as `0x${string}`))],
    [tokens]
  );

  return useQuery({
    queryKey: ["usd-prices", uniqueTokens],
    queryFn: () => fetchUsdPrices(uniqueTokens),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function getTokenUsd(
  prices: Map<string, number> | undefined,
  address: `0x${string}` | undefined
) {
  if (!prices || !address) return undefined;
  return prices.get(address.toLowerCase());
}

export function formatUsdValue(amount: bigint, decimals: number, priceUsd?: number) {
  if (priceUsd === undefined) return undefined;
  const scaled = parseFloat(formatUnits(amount, decimals));
  if (!Number.isFinite(scaled)) return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(scaled * priceUsd);
}
