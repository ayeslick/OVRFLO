"use client";

import type { Address } from "viem";
import { factoryDeployment, isConfiguredAddress } from "@/lib/config";
import {
  discoverAccountLoanBook,
  discoverMarketLiquidity,
  discoverHeldStreams,
  discoverBorrowDemand,
  type AccountLoanBookProjection,
  type MarketLiquidityProjection,
  type HeldStreamProjection,
  type BorrowDemandProjection,
} from "@/lib/discovery/live-projection";
import { useProjectionSync } from "./useProjectionSync";

export function useMarketLiquidityProjection(
  lending: Address | null | undefined,
  market: Address | null | undefined,
) {
  return useProjectionSync<MarketLiquidityProjection>({
    scope: {
      lending,
      kind: "market-apr",
      market,
    },
    enabled:
      isConfiguredAddress(lending ?? null) &&
      isConfiguredAddress(market ?? null),
    queryFn: (client, signal) =>
      discoverMarketLiquidity({
        client,
        lending: lending as Address,
        market: market as Address,
        fromBlock: factoryDeployment.blockNumber,
        signal,
      }),
  });
}

export function useAccountLoanBookProjection(
  lending: Address | null | undefined,
  account: Address | null | undefined,
  refetchInterval?: number,
) {
  return useProjectionSync<AccountLoanBookProjection>({
    scope: {
      lending,
      kind: "lender",
      account,
    },
    enabled:
      isConfiguredAddress(lending ?? null) &&
      isConfiguredAddress(account ?? null),
    queryFn: (client, signal) =>
      discoverAccountLoanBook({
        client,
        lending: lending as Address,
        account: account as Address,
        fromBlock: factoryDeployment.blockNumber,
        signal,
      }),
    refetchInterval,
  });
}

export function useHeldStreamProjection(
  vaults: readonly Address[],
  account: Address | null | undefined,
  registryReady: boolean,
) {
  return useProjectionSync<HeldStreamProjection>({
    scope: {
      kind: "stream",
      account,
    },
    enabled: registryReady && isConfiguredAddress(account ?? null),
    queryFn: (client, signal) =>
      discoverHeldStreams({
        client,
        vaults,
        account: account as Address,
        fromBlock: factoryDeployment.blockNumber,
        signal,
      }),
  });
}

export function useBorrowDemandProjection(
  lending: Address | null | undefined,
  market: Address | null | undefined,
) {
  return useProjectionSync<BorrowDemandProjection>({
    scope: {
      lending,
      kind: "demand",
      market,
    },
    enabled:
      isConfiguredAddress(lending ?? null) &&
      isConfiguredAddress(market ?? null),
    queryFn: (client, signal) =>
      discoverBorrowDemand({
        client,
        lending: lending as Address,
        market: market as Address,
        fromBlock: factoryDeployment.blockNumber,
        signal,
      }),
  });
}
