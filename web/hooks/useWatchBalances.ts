"use client";

import { useConnection, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import type { MoneyRead } from "@/components/assets/helpers";
import { readQuery } from "@/lib/query-keys";
import type { MarketInfo } from "@/lib/types";
import { useNowSecondsHydrationSafe } from "./useNowSeconds";

export type WatchBalances = {
  wrapReserve: MoneyRead;
  walletOvrflo: MoneyRead;
  walletUnderlying: MoneyRead;
  ovrfloAllowance: MoneyRead;
  matured: boolean;
};

function moneyRead(
  status: string | undefined,
  result: unknown,
  isLoading: boolean,
  enabled: boolean,
): MoneyRead {
  if (!enabled || isLoading) return { status: "loading" };
  if (status !== "success" || typeof result !== "bigint") return { status: "unavailable" };
  return { status: "ready", value: result };
}

export function useWatchBalances(
  market: Pick<MarketInfo, "vault" | "lending" | "underlying" | "ovrfloToken" | "expiryCached"> | null,
): WatchBalances {
  const connection = useConnection();
  const user = connection.addresses?.[0] as Address | undefined;
  const now = useNowSecondsHydrationSafe();
  const lending = market?.lending ?? null;
  const enabled = Boolean(user && market && lending && connection.status === "connected");
  const reads = useReadContracts({
    allowFailure: true,
    contracts:
      user && market && lending
        ? [
            { address: market.underlying, abi: erc20Abi, functionName: "balanceOf", args: [user] },
            { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf", args: [user] },
            {
              address: market.ovrfloToken,
              abi: erc20Abi,
              functionName: "allowance",
              args: [user, lending],
            },
            { address: market.vault, abi: ovrfloAbi, functionName: "wrappedUnderlying" },
          ]
        : [],
    query: { ...readQuery, enabled },
  });

  return {
    walletUnderlying: moneyRead(reads.data?.[0]?.status, reads.data?.[0]?.result, reads.isLoading, enabled),
    walletOvrflo: moneyRead(reads.data?.[1]?.status, reads.data?.[1]?.result, reads.isLoading, enabled),
    ovrfloAllowance: moneyRead(reads.data?.[2]?.status, reads.data?.[2]?.result, reads.isLoading, enabled),
    wrapReserve: moneyRead(reads.data?.[3]?.status, reads.data?.[3]?.result, reads.isLoading, enabled),
    matured: Boolean(market && now !== null && now >= market.expiryCached),
  };
}
