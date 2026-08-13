"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress } from "@/lib/config";
import { shapeLadder, type LadderModel } from "@/lib/ladder";
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { useLending, type LendingConfig } from "./useLending";

export type LadderData = {
  model: LadderModel;
  config: LendingConfig;
  tickSpacing: number;
};

/**
 * One-read ladder: `tickDepths(market)` plus book constants.
 * Confirmed-empty (every rung zero after a successful read) is distinct from
 * unavailable (SpacingUnset / RPC failure).
 */
export function useLadder(
  lending: Address | null | undefined,
  market: Address | null | undefined,
): ReadOutcome<LadderData> {
  const lendingReads = useLending(lending);
  const enabled =
    isConfiguredAddress(lending ?? null) && isConfiguredAddress(market ?? null);
  const depthReads = useReadContracts({
    allowFailure: true,
    contracts:
      enabled && lending && market
        ? [
            { address: lending, abi: ovrfloLendingAbi, functionName: "tickDepths", args: [market] },
            { address: lending, abi: ovrfloLendingAbi, functionName: "tickSpacing", args: [market] },
          ]
        : [],
    query: { ...readQuery, enabled },
  });

  return useMemo(() => {
    if (!enabled) return loadingOutcome<LadderData>();
    if (lendingReads.outcome.status === "unavailable") {
      return unavailableOutcome<LadderData>(lendingReads.outcome.failures);
    }
    if (
      lendingReads.outcome.status === "loading" ||
      (depthReads.isLoading && !depthReads.data)
    ) {
      return loadingOutcome<LadderData>();
    }
    if (lendingReads.outcome.status !== "ready") {
      return unavailableOutcome<LadderData>([
        readFailure("useLadder", "incomplete", "Lending config is not ready"),
      ]);
    }
    const rows = depthReads.data;
    if (!rows || rows.length !== 2 || rows.some((result) => result.status !== "success")) {
      return unavailableOutcome<LadderData>([
        readFailure(
          "useLadder",
          depthReads.error ? "transport" : "subcall",
          depthReads.error ?? "tickDepths read failed",
        ),
      ]);
    }
    const depths = (rows[0]!.result ?? []) as readonly { aprBps: number; availableUnits: bigint }[];
    const tickSpacing = Number(rows[1]!.result ?? 0);
    const model = shapeLadder(
      depths.map((depth) => ({
        aprBps: depth.aprBps,
        availableUnits: depth.availableUnits,
      })),
      {
        unit: lendingReads.outcome.data.unit,
        minLiquidity: lendingReads.outcome.data.minLiquidityAmount,
      },
    );
    return readyOutcome({
      model,
      config: lendingReads.outcome.data,
      tickSpacing,
    });
  }, [depthReads.data, depthReads.error, depthReads.isLoading, enabled, lendingReads.outcome]);
}
