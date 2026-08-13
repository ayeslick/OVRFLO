"use client";

import { useMemo, useRef } from "react";
import { classifyFreshness, signingAllowed, type Freshness } from "@/lib/freshness";
import type { ReadOutcome } from "@/lib/read-outcome";
import { useClock } from "./useClock";

export type FreshnessSource = {
  status: "success" | "pending" | "error" | "idle";
  dataUpdatedAt?: number;
};

/**
 * Split-truth freshness (AE1 / R8). Schedule interpolation keeps moving;
 * this classifies event-truth as-of the last successful read.
 */
export function useFreshness(sources: readonly FreshnessSource[]): {
  freshness: Freshness;
  signingAllowed: boolean;
} {
  const clock = useClock();
  const lastSuccessAt = useRef<bigint | null>(null);

  const freshness = useMemo(() => {
    const anySuccess = sources.some((source) => source.status === "success");
    const anyError = sources.some((source) => source.status === "error");
    const anyPending = sources.some((source) => source.status === "pending");
    if (anySuccess) {
      lastSuccessAt.current = clock.adjustedNow;
    }
    const status = anyError
      ? "error"
      : anyPending
        ? "pending"
        : anySuccess
          ? "success"
          : "idle";
    return classifyFreshness({
      lastSuccessAt: lastSuccessAt.current,
      status,
    });
  }, [clock.adjustedNow, sources]);

  return { freshness, signingAllowed: signingAllowed(freshness) };
}

export function sourceFromOutcome(outcome: ReadOutcome<unknown>): FreshnessSource {
  if (outcome.status === "ready" && outcome.freshness === "fresh") {
    return { status: "success" };
  }
  if (outcome.status === "loading") return { status: "pending" };
  if (outcome.status === "unavailable") return { status: "error" };
  if (outcome.status === "partial" || outcome.status === "ready") {
    return { status: outcome.freshness === "stale" ? "error" : "success" };
  }
  return { status: "idle" };
}
