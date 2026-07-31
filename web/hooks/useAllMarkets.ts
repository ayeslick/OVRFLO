"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { ovrfloAbi, ovrfloFactoryAbi } from "@/lib/abis";
import { factoryAddress, ZERO_ADDRESS } from "@/lib/config";
import type { MarketInfo } from "@/lib/types";
import { bigintToSafeLength, MAX_VAULT_ENUMERATION, useOvrflos } from "./useOvrflos";

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
  const marketCountsComplete =
    ovrflos.vaults.length === 0 ||
    (marketCountReads.data?.length === ovrflos.vaults.length &&
      marketCountReads.data.every((result) => result.status === "success"));
  const totalMarketCount = marketCountsComplete
    ? (marketCountReads.data ?? []).reduce(
        (total, result) => total + asBigInt(result.result),
        0n,
      )
    : 0n;
  const marketBudgetExceeded = totalMarketCount > MAX_VAULT_ENUMERATION;

  const marketAddressContracts = useMemo(() => {
    if (!marketCountsComplete || marketBudgetExceeded) return [];
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
  }, [
    marketBudgetExceeded,
    marketCountReads.data,
    marketCountsComplete,
    ovrflos.vaults,
  ]);

  const marketAddressReads = useReadContracts({
    contracts: marketAddressContracts,
    query: { enabled: marketAddressContracts.length > 0 },
  });
  const marketAddressesComplete =
    marketCountsComplete &&
    !marketBudgetExceeded &&
    (marketAddressContracts.length === 0 ||
      (marketAddressReads.data?.length === marketAddressContracts.length &&
        marketAddressReads.data.every((result) => result.status === "success")));

  const marketSeriesContracts = useMemo(() => {
    if (!marketAddressesComplete) return [];
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
  }, [
    marketAddressReads.data,
    marketAddressesComplete,
    marketCountReads.data,
    ovrflos.vaults,
  ]);

  const seriesReads = useReadContracts({
    contracts: marketSeriesContracts,
    query: { enabled: marketSeriesContracts.length > 0 },
  });
  const seriesComplete =
    marketAddressesComplete &&
    (marketSeriesContracts.length === 0 ||
      (seriesReads.data?.length === marketSeriesContracts.length &&
        seriesReads.data.every((result) => result.status === "success")));

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

  const registrySettled =
    !ovrflos.isLoading &&
    !marketCountReads.isLoading &&
    !marketAddressReads.isLoading &&
    !seriesReads.isLoading;
  const incomplete =
    registrySettled &&
    !marketBudgetExceeded &&
    (!marketCountsComplete || !marketAddressesComplete || !seriesComplete);
  const isLoading =
    ovrflos.isLoading ||
    marketCountReads.isLoading ||
    marketAddressReads.isLoading ||
    seriesReads.isLoading;
  const error =
    ovrflos.error ??
    marketCountReads.error ??
    marketAddressReads.error ??
    seriesReads.error ??
    (incomplete ? new Error("Market registry hydration is incomplete") : null);

  return {
    markets:
      marketBudgetExceeded || !marketCountsComplete || !seriesComplete
        ? []
        : markets,
    tooLarge: ovrflos.tooLarge || marketBudgetExceeded,
    status: isLoading ? "loading" as const : error ? "unavailable" as const : "ready" as const,
    isLoading,
    error,
  };
}

function asBigInt(value: unknown) {
  return typeof value === "bigint" ? value : 0n;
}

function asAddress(value: unknown) {
  return typeof value === "string" && value.startsWith("0x") ? (value as `0x${string}`) : ZERO_ADDRESS;
}
