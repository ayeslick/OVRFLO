"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { chainlinkAggregatorAbi } from "@/lib/abis";

const erc20DecimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { classifyUsd, USD_HEARTBEAT_GRACE_SECONDS, type ChainlinkRound, type UsdQuote } from "@/lib/usd";
import { lookupUsdRecipe } from "@/lib/usd-recipes";
import { useClock } from "./useClock";

function asRound(result: unknown): ChainlinkRound | null {
  if (!Array.isArray(result) || result.length < 5) return null;
  const roundId = result[0];
  const answer = result[1];
  const updatedAt = result[3];
  const answeredInRound = result[4];
  if (
    typeof roundId !== "bigint" ||
    typeof answer !== "bigint" ||
    typeof updatedAt !== "bigint" ||
    typeof answeredInRound !== "bigint"
  ) {
    return null;
  }
  return { roundId, answer, updatedAt, answeredInRound };
}

/**
 * Display-only USD reference keyed by column underlying.
 * Never on receipts, never in calldata, never a write gate.
 */
export function useUsdPrice(underlying: Address | undefined): ReadOutcome<UsdQuote> {
  const clock = useClock();
  const recipe = underlying ? lookupUsdRecipe(underlying) : null;
  const share = recipe?.shareRate;
  const reads = useReadContracts({
    allowFailure: true,
    // Mixed aggregator / decimals / share-rate ABIs do not share one wagmi tuple.
    contracts: (recipe
      ? [
          {
            address: recipe.aggregator,
            abi: chainlinkAggregatorAbi,
            functionName: "latestRoundData",
          },
          {
            address: recipe.underlying,
            abi: erc20DecimalsAbi,
            functionName: "decimals",
          },
          ...(share
            ? [
                {
                  address: share.contract,
                  abi: [
                    {
                      type: "function" as const,
                      name: share.functionName,
                      stateMutability: "view" as const,
                      inputs: [],
                      outputs: [{ name: "", type: "uint256" }],
                    },
                  ],
                  functionName: share.functionName,
                },
              ]
            : []),
          ...(recipe.kind === "chainlink-eth-usd-times-eth-rate" && recipe.ethUsdAggregator
            ? [
                {
                  address: recipe.ethUsdAggregator,
                  abi: chainlinkAggregatorAbi,
                  functionName: "latestRoundData" as const,
                },
              ]
            : []),
        ]
      : []) as unknown as [],
    query: { ...readQuery, enabled: Boolean(recipe) },
  });

  return useMemo(() => {
    if (!recipe) {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", "incomplete", "USD recipe is missing for this underlying"),
      ]);
    }
    if (reads.isLoading && !reads.data) return loadingOutcome<UsdQuote>();
    const rows = (reads.data ?? []) as readonly { status?: string; result?: unknown }[];
    if (!rows[0] || rows[0].status !== "success" || !rows[1] || rows[1].status !== "success") {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", reads.error ? "transport" : "subcall", reads.error ?? "USD feed unavailable"),
      ]);
    }
    const decimals = rows[1].result;
    if (decimals !== 18 && decimals !== 18n) {
      return readyOutcome({ status: "unavailable", reason: "decimals" });
    }
    const round = asRound(rows[0]?.result);
    if (!round) {
      return unavailableOutcome<UsdQuote>([
        readFailure("useUsdPrice", "incomplete", "USD feed round is incomplete"),
      ]);
    }
    let shareRate: bigint | undefined;
    let cursor = 2;
    if (share) {
      const shareRow = rows[cursor];
      cursor += 1;
      if (shareRow?.status !== "success" || typeof shareRow.result !== "bigint") {
        return unavailableOutcome<UsdQuote>([
          readFailure("useUsdPrice", "incomplete", "USD share rate is incomplete"),
        ]);
      }
      shareRate = shareRow.result;
    }
    let ethUsdRound: ChainlinkRound | undefined;
    if (recipe.kind === "chainlink-eth-usd-times-eth-rate") {
      const ethRow = rows[cursor];
      if (ethRow?.status !== "success") {
        return unavailableOutcome<UsdQuote>([
          readFailure("useUsdPrice", "incomplete", "ETH/USD feed is incomplete"),
        ]);
      }
      const parsed = asRound(ethRow.result);
      if (!parsed) {
        return unavailableOutcome<UsdQuote>([
          readFailure("useUsdPrice", "incomplete", "ETH/USD feed is incomplete"),
        ]);
      }
      ethUsdRound = parsed;
    }
    const quote = classifyUsd({
      round,
      now: clock.adjustedNow,
      heartbeat: recipe.heartbeatSeconds,
      grace: USD_HEARTBEAT_GRACE_SECONDS,
      kind: recipe.kind,
      feedDecimals: recipe.feedDecimals,
      shareRate,
      ethUsdRound,
    });
    return readyOutcome(quote);
  }, [clock.adjustedNow, reads.data, reads.error, reads.isLoading, recipe, share]);
}
