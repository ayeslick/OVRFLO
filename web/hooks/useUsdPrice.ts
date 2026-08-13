"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { chainlinkAggregatorAbi, wstethAbi } from "@/lib/abis";
import { CHAINLINK_STETH_USD, WSTETH_ADDRESS } from "@/lib/config";
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { classifyUsd, type UsdQuote } from "@/lib/usd";
import { useClock } from "./useClock";

/**
 * Display-only USD reference: stETH/USD × stEthPerToken.
 * Never on receipts, never in calldata, never a write gate (KTD14).
 */
export function useUsdPrice(): ReadOutcome<UsdQuote> {
  const clock = useClock();
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: CHAINLINK_STETH_USD,
        abi: chainlinkAggregatorAbi,
        functionName: "latestRoundData",
      },
      {
        address: WSTETH_ADDRESS,
        abi: wstethAbi,
        functionName: "stEthPerToken",
      },
    ],
    query: { ...readQuery, enabled: true },
  });

  return useMemo(() => {
    if (reads.isLoading && !reads.data) return loadingOutcome<UsdQuote>();
    const rows = reads.data;
    if (!rows || rows.length !== 2 || rows.some((result) => result.status !== "success")) {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", reads.error ? "transport" : "subcall", reads.error ?? "USD feed unavailable"),
      ]);
    }
    const round = rows[0]?.result;
    const stEthPerToken = rows[1]?.result;
    if (!round || stEthPerToken === undefined) {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", "incomplete", "USD feed round is incomplete"),
      ]);
    }
    const answer = round[1];
    const updatedAt = round[3];
    if (answer === undefined || updatedAt === undefined) {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", "incomplete", "USD feed round is incomplete"),
      ]);
    }
    const quote = classifyUsd(
      { answer, updatedAt },
      stEthPerToken,
      clock.adjustedNow,
    );
    return readyOutcome(quote);
  }, [clock.adjustedNow, reads.data, reads.error, reads.isLoading]);
}
