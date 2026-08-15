"use client";

import { useMemo, useRef } from "react";
import {
  classifyFreshness,
  signingAllowed,
  type Freshness,
} from "@/lib/freshness";
import { READ_INTERVAL_MS } from "@/lib/query-keys";
import type { ReadOutcome } from "@/lib/read-outcome";
import { useClock } from "./useClock";

/** Default discard bound: three quiet poll cycles without a success. */
export const FRESHNESS_MAX_AGE_MS = READ_INTERVAL_MS * 3;

export type FreshnessSource = {
  status: "success" | "pending" | "error" | "idle";
  /** Query / outcome success timestamp in ms (TanStack dataUpdatedAt). */
  dataUpdatedAt?: number;
};

/**
 * Split-truth freshness (AE1 / R8). Schedule interpolation keeps moving;
 * this classifies event-truth as-of the last successful read.
 *
 * Pass one lens's sources only — caption and signingAllowed are per lens.
 */
export function useFreshness(
  sources: readonly FreshnessSource[],
  options: { maxAgeMs?: number } = {},
): {
  freshness: Freshness;
  signingAllowed: boolean;
} {
  const clock = useClock();
  const lastSuccessAt = useRef<bigint | null>(null);
  const maxAgeMs = options.maxAgeMs ?? FRESHNESS_MAX_AGE_MS;

  const freshness = useMemo(() => {
    const anySuccess = sources.some((source) => source.status === "success");
    const anyError = sources.some((source) => source.status === "error");
    const anyPending = sources.some((source) => source.status === "pending");

    if (anySuccess) {
      const stamps = sources
        .filter((source) => source.status === "success" && source.dataUpdatedAt)
        .map((source) => source.dataUpdatedAt!);
      if (stamps.length > 0) {
        // EVENTS AS OF must come from the read success, never the clock tick.
        lastSuccessAt.current = BigInt(Math.floor(Math.max(...stamps) / 1000));
      } else if (lastSuccessAt.current === null) {
        lastSuccessAt.current = clock.adjustedNow;
      }
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
      now: Number(clock.adjustedNow) * 1000,
      maxAgeMs,
    });
  }, [clock.adjustedNow, maxAgeMs, sources]);

  return { freshness, signingAllowed: signingAllowed(freshness) };
}

export function sourceFromOutcome(outcome: ReadOutcome<unknown>): FreshnessSource {
  const dataUpdatedAt = outcome.metadata.dataUpdatedAt;
  if (outcome.status === "ready" && outcome.freshness === "fresh") {
    return { status: "success", dataUpdatedAt };
  }
  if (outcome.status === "loading") return { status: "pending", dataUpdatedAt };
  if (outcome.status === "unavailable") return { status: "error", dataUpdatedAt };
  if (outcome.status === "partial" || outcome.status === "ready") {
    return {
      status: outcome.freshness === "stale" ? "error" : "success",
      dataUpdatedAt,
    };
  }
  return { status: "idle", dataUpdatedAt };
}
