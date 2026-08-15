export type FreshnessKind = "synced" | "reconnecting" | "degraded" | "unavailable";

export type ReadQueryStatus = "success" | "pending" | "error" | "idle";

export type Freshness = {
  kind: FreshnessKind;
  asOf: bigint | null;
};

export type FreshnessInput = {
  lastSuccessAt: bigint | null;
  status: ReadQueryStatus;
  /** Wall-clock ms used with maxAgeMs to discard an aged success. */
  now?: number;
  /** Past this age a prior success is discarded (not shown behind a warning). */
  maxAgeMs?: number;
};

/**
 * Split-truth classification (AE1 / KTD6).
 * Schedule interpolation keeps moving regardless of this class.
 * USD unavailability is `usd.staleness`, not this key.
 */
export function classifyFreshness(input: FreshnessInput): Freshness {
  let asOf = input.lastSuccessAt;
  let status = input.status;

  if (
    asOf !== null &&
    input.maxAgeMs !== undefined &&
    input.now !== undefined &&
    input.now - Number(asOf) * 1000 > input.maxAgeMs
  ) {
    // Past the bound: discard. Do not keep a warning caption over stale figures.
    asOf = null;
    if (status === "success" || status === "pending" || status === "error") {
      status = "idle";
    }
  }

  if (status === "success" && asOf !== null) {
    return { kind: "synced", asOf };
  }
  if (status === "pending" && asOf !== null) {
    return { kind: "reconnecting", asOf };
  }
  if (status === "error" && asOf !== null) {
    return { kind: "degraded", asOf };
  }
  if ((status === "error" || status === "idle") && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  if (status === "pending" && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  if (status === "success" && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  return { kind: "unavailable", asOf };
}

export function signingAllowed(freshness: Freshness): boolean {
  return freshness.kind === "synced";
}
