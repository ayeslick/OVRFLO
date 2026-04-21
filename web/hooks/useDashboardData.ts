"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { CHAIN_ID } from "@/lib/config";
import { useAllMarkets, type MarketInfo } from "@/hooks/useAllMarkets";
import {
  useOvrfloAddresses,
  useOvrfloCount,
  useOvrfloInfos,
  type OvrfloEntry,
} from "@/hooks/useOvrflos";
import { useUserStreams } from "@/hooks/useStreams";
import type { SablierStream } from "@/lib/sablier";

type HexAddress = `0x${string}`;

export interface DashboardData {
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  streams: SablierStream[];
  actionsDisabled: boolean;
  launchReadError?: Error;
}

export function useDashboardData(): DashboardData {
  const { address, isConnected, chainId } = useAccount();

  const countResult = useOvrfloCount();
  const rawCount = countResult.data?.[0]?.result;
  const count = typeof rawCount === "bigint" ? Number(rawCount) : 0;

  const addressesResult = useOvrfloAddresses(count);
  const ovrfloAddresses = useMemo<HexAddress[]>(() => {
    return (addressesResult.data ?? [])
      .map((entry) => entry?.result as HexAddress | undefined)
      .filter((addr): addr is HexAddress => Boolean(addr));
  }, [addressesResult.data]);

  const infosResult = useOvrfloInfos(ovrfloAddresses);
  const ovrflos = useMemo<OvrfloEntry[]>(() => {
    return ovrfloAddresses.map((addr, i) => {
      const info = infosResult.data?.[i]?.result as
        | readonly [HexAddress, HexAddress, HexAddress]
        | undefined;
      return {
        address: addr,
        treasury: info?.[0] ?? ("0x0000000000000000000000000000000000000000" as HexAddress),
        underlying: info?.[1] ?? ("0x0000000000000000000000000000000000000000" as HexAddress),
        ovrfloToken: info?.[2] ?? ("0x0000000000000000000000000000000000000000" as HexAddress),
      };
    });
  }, [ovrfloAddresses, infosResult.data]);

  const { markets: allMarkets, error: marketsError } = useAllMarkets(ovrflos);

  const streamsQuery = useUserStreams(
    address,
    ovrflos.map((o) => o.address)
  );

  const launchReadError = useMemo<Error | undefined>(() => {
    if (countResult.error instanceof Error) return countResult.error;
    if (addressesResult.error instanceof Error) return addressesResult.error;
    if (infosResult.error instanceof Error) return infosResult.error;
    if (marketsError) return marketsError;
    return undefined;
  }, [countResult.error, addressesResult.error, infosResult.error, marketsError]);

  const actionsDisabled =
    !isConnected || chainId !== CHAIN_ID || Boolean(launchReadError);

  return {
    ovrflos,
    allMarkets,
    streams: streamsQuery.data ?? [],
    actionsDisabled,
    launchReadError,
  };
}
