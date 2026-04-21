"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import { PRICE_API_URL } from "@/lib/config";
import { ovrfloAbi } from "@/lib/contracts";
import type { MarketInfo } from "@/hooks/useAllMarkets";

export interface UsdPrices {
  underlyingUsd: Map<string, number>;
  ptUsd: Map<string, number>;
  ovrfloUsd: Map<string, number>;
}

const EMPTY_PRICES: UsdPrices = {
  underlyingUsd: new Map(),
  ptUsd: new Map(),
  ovrfloUsd: new Map(),
};

async function safeFetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

async function fetchExternalPrices(
  addresses: `0x${string}`[]
): Promise<{ underlyingUsd: Map<string, number> }> {
  const underlyingUsd = new Map<string, number>();

  if (!addresses.length) return { underlyingUsd };

  const tokenJson = await safeFetchJson<Record<string, { usd?: number }>>(
    `${PRICE_API_URL}/simple/token_price/ethereum?contract_addresses=${addresses.join(",")}&vs_currencies=usd`
  );

  if (tokenJson) {
    for (const [addr, entry] of Object.entries(tokenJson)) {
      if (typeof entry?.usd === "number") {
        underlyingUsd.set(addr.toLowerCase(), entry.usd);
      }
    }
  }

  return { underlyingUsd };
}

export interface UseUsdPricesArgs {
  underlyings: (`0x${string}` | undefined)[];
  markets: MarketInfo[];
}

export function useUsdPrices({ underlyings, markets }: UseUsdPricesArgs) {
  const uniqueUnderlyings = useMemo<`0x${string}`[]>(
    () =>
      [
        ...new Set(
          underlyings
            .filter((t): t is `0x${string}` => !!t)
            .map((t) => t.toLowerCase() as `0x${string}`)
        ),
      ],
    [underlyings]
  );

  const external = useQuery({
    queryKey: ["usd-prices-external", PRICE_API_URL, uniqueUnderlyings],
    queryFn: () => fetchExternalPrices(uniqueUnderlyings),
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  const rateContracts = useMemo(
    () =>
      markets.map((m) => ({
        address: m.ovrflo,
        abi: ovrfloAbi,
        functionName: "previewRate" as const,
        args: [m.market] as const,
      })),
    [markets]
  );

  const { data: rateResults } = useReadContracts({
    contracts: rateContracts,
    query: { enabled: rateContracts.length > 0, staleTime: 60_000 },
  });

  const prices = useMemo<UsdPrices>(() => {
    const underlyingUsd = external.data?.underlyingUsd ?? EMPTY_PRICES.underlyingUsd;
    const ptUsd = new Map<string, number>();
    const ovrfloUsd = new Map<string, number>();

    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    markets.forEach((m, i) => {
      const undUsd = underlyingUsd.get(m.underlying.toLowerCase());
      if (undUsd === undefined) return;

      const rateRes = rateResults?.[i];
      const rateRaw =
        rateRes && rateRes.status === "success"
          ? (rateRes.result as bigint)
          : undefined;

      const rate = rateRaw ?? 10n ** 18n;
      // previewRate is quoted in PT/ovrflo 1e18 terms: priceUsd(PT) = priceUsd(underlying) * rate / 1e18.
      const ptPrice = (undUsd * Number(formatUnits(rate, 18)));
      if (Number.isFinite(ptPrice)) {
        ptUsd.set(m.market.toLowerCase(), ptPrice);
      }
      const matured = m.expiry <= nowSec;
      const ovrfloPrice = matured ? undUsd : ptPrice;
      if (Number.isFinite(ovrfloPrice)) {
        ovrfloUsd.set(m.market.toLowerCase(), ovrfloPrice);
      }
    });

    return {
      underlyingUsd,
      ptUsd,
      ovrfloUsd,
    };
  }, [external.data, markets, rateResults]);

  return {
    data: prices,
    isLoading: external.isLoading,
    error: external.error as Error | null,
  };
}

export function getUnderlyingUsd(
  prices: UsdPrices | undefined,
  address: `0x${string}` | undefined
) {
  if (!prices || !address) return undefined;
  return prices.underlyingUsd.get(address.toLowerCase());
}

export function getPtUsdForMarket(
  prices: UsdPrices | undefined,
  market: `0x${string}` | undefined
) {
  if (!prices || !market) return undefined;
  return prices.ptUsd.get(market.toLowerCase());
}

export function getOvrfloUsdForMarket(
  prices: UsdPrices | undefined,
  market: `0x${string}` | undefined
) {
  if (!prices || !market) return undefined;
  return prices.ovrfloUsd.get(market.toLowerCase());
}

export function formatUsdValue(
  amount: bigint,
  decimals: number,
  priceUsd?: number
) {
  if (priceUsd === undefined) return undefined;
  try {
    const scaled = parseFloat(formatUnits(amount, decimals));
    if (!Number.isFinite(scaled)) return undefined;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(scaled * priceUsd);
  } catch {
    return undefined;
  }
}
