"use client";

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress } from "@/lib/config";
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";

export type LendingConfig = {
  unit: bigint;
  minLiquidityAmount: bigint;
  minStreamAmount: bigint;
  feeBps: number;
  aprMinBps: number;
  aprMaxBps: number;
};

const INCOMPLETE = "Required lending parameters are incomplete";

/**
 * Book constants for one lending market. Cached long; never duplicated in
 * `web/lib/config.ts`. Read failure is unavailable, never zero (AE1).
 */
export function useLending(lending: Address | null | undefined): {
  outcome: ReadOutcome<LendingConfig>;
  isLoading: boolean;
  error: Error | null;
} {
  const enabled = isConfiguredAddress(lending ?? null);
  const reads = useReadContracts({
    allowFailure: true,
    contracts: lending
      ? [
          { address: lending, abi: ovrfloLendingAbi, functionName: "UNIT" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "MIN_LIQUIDITY_AMOUNT" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "MIN_STREAM_AMOUNT" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "feeBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMinBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMaxBps" },
        ]
      : [],
    query: { ...readQuery, enabled },
  });

  if (!enabled) {
    return {
      outcome: loadingOutcome<LendingConfig>(),
      isLoading: false,
      error: null,
    };
  }
  if (reads.isLoading && !reads.data) {
    return {
      outcome: loadingOutcome<LendingConfig>(),
      isLoading: true,
      error: null,
    };
  }

  const rows = reads.data;
  const complete =
    rows?.length === 6 && rows.every((result) => result.status === "success");
  if (!complete) {
    const failure = readFailure(
      "useLending",
      reads.error ? "transport" : "incomplete",
      reads.error ?? INCOMPLETE,
    );
    return {
      outcome: unavailableOutcome<LendingConfig>([failure]),
      isLoading: false,
      error: reads.error instanceof Error ? reads.error : new Error(INCOMPLETE),
    };
  }

  const config: LendingConfig = {
    unit: asBigint(rows[0]!.result),
    minLiquidityAmount: asBigint(rows[1]!.result),
    minStreamAmount: asBigint(rows[2]!.result),
    feeBps: asNumber(rows[3]!.result),
    aprMinBps: asNumber(rows[4]!.result),
    aprMaxBps: asNumber(rows[5]!.result),
  };
  return {
    outcome: readyOutcome(config),
    isLoading: false,
    error: null,
  };
}

function asBigint(value: unknown): bigint {
  return typeof value === "bigint" ? value : 0n;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}
