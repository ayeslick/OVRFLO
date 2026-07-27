"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { ovrfloAbi, ovrfloFactoryAbi } from "@/lib/abis";
import { factoryAddress, ZERO_ADDRESS } from "@/lib/config";
import type { MarketInfo } from "@/lib/types";
import { bigintToSafeLength, useOvrflos } from "./useOvrflos";

export function useAllMarkets() {
  const ovrflos = useOvrflos(factoryAddress);

  const marketCountReads = useReadContracts({
    contracts: ovrflos.vaults.map((vault) => ({
      address: factoryAddress,
      abi: ovrfloFactoryAbi,
      functionName: "approvedMarketCount",
      args: [vault.vault],
    })),
    query: { enabled: ovrflos.vaults.length > 0 },
  });

  const marketAddressContracts = useMemo(() => {
    return ovrflos.vaults.flatMap((vault, vaultIndex) => {
      const countResult = marketCountReads.data?.[vaultIndex];
      const count = countResult?.status === "success" ? asBigInt(countResult.result) : 0n;
      return Array.from({ length: bigintToSafeLength(count) }, (_, index) => ({
        address: factoryAddress,
        abi: ovrfloFactoryAbi,
        functionName: "approvedMarketAt" as const,
        args: [vault.vault, BigInt(index)] as const,
      }));
    });
  }, [marketCountReads.data, ovrflos.vaults]);

  const marketAddressReads = useReadContracts({
    contracts: marketAddressContracts,
    query: { enabled: marketAddressContracts.length > 0 },
  });

  const marketSeriesContracts = useMemo(() => {
    let readIndex = 0;
    return ovrflos.vaults.flatMap((vault, vaultIndex) => {
      const countResult = marketCountReads.data?.[vaultIndex];
      const count = countResult?.status === "success" ? asBigInt(countResult.result) : 0n;
      return Array.from({ length: bigintToSafeLength(count) }, () => {
        const marketResult = marketAddressReads.data?.[readIndex++];
        const market = marketResult?.status === "success" ? asAddress(marketResult.result) : ZERO_ADDRESS;
        return {
          address: vault.vault,
          abi: ovrfloAbi,
          functionName: "series" as const,
          args: [market] as const,
        };
      });
    });
  }, [marketAddressReads.data, marketCountReads.data, ovrflos.vaults]);

  const seriesReads = useReadContracts({
    contracts: marketSeriesContracts,
    query: { enabled: marketSeriesContracts.length > 0 },
  });

  const markets = useMemo<MarketInfo[]>(() => {
    const rows: MarketInfo[] = [];
    let readIndex = 0;
    for (const [vaultIndex, vault] of ovrflos.vaults.entries()) {
      const count = marketCountReads.data?.[vaultIndex];
      const marketCount = count?.status === "success" ? asBigInt(count.result) : 0n;
      for (let offset = 0; offset < bigintToSafeLength(marketCount); offset++) {
        const marketResult = marketAddressReads.data?.[readIndex];
        const seriesResult = seriesReads.data?.[readIndex];
        readIndex++;
        if (marketResult?.status !== "success" || seriesResult?.status !== "success") continue;
        const [twapDurationFixed, feeBps, expiryCached, ptToken, ovrfloToken, underlying, oracle] =
          seriesResult.result;
        if (ptToken === ZERO_ADDRESS) continue;
        rows.push({
          ...vault,
          market: asAddress(marketResult.result),
          twapDurationFixed,
          feeBps,
          expiryCached,
          ptToken,
          ovrfloToken,
          underlying,
          oracle,
        });
      }
    }
    return rows;
  }, [marketAddressReads.data, marketCountReads.data, ovrflos.vaults, seriesReads.data]);

  return {
    markets,
    isLoading: ovrflos.isLoading || marketCountReads.isLoading || marketAddressReads.isLoading || seriesReads.isLoading,
    error: ovrflos.error ?? marketCountReads.error ?? marketAddressReads.error ?? seriesReads.error,
  };
}

function asBigInt(value: unknown) {
  return typeof value === "bigint" ? value : 0n;
}

function asAddress(value: unknown) {
  return typeof value === "string" && value.startsWith("0x") ? (value as `0x${string}`) : ZERO_ADDRESS;
}
