export type FreshnessKind = "synced" | "reconnecting" | "degraded" | "unavailable";

export type ReadQueryStatus = "success" | "pending" | "error" | "idle";

export type Freshness = {
  kind: FreshnessKind;
  asOf: bigint | null;
};

export type FreshnessInput = {
  lastSuccessAt: bigint | null;
  status: ReadQueryStatus;
};

/**
 * Split-truth classification (AE1 / KTD6).
 * Schedule interpolation keeps moving regardless of this class.
 * USD unavailability is `usd.staleness`, not this key.
 */
export function classifyFreshness(input: FreshnessInput): Freshness {
  const asOf = input.lastSuccessAt;
  if (input.status === "success" && asOf !== null) {
    return { kind: "synced", asOf };
  }
  if (input.status === "pending" && asOf !== null) {
    return { kind: "reconnecting", asOf };
  }
  if (input.status === "error" && asOf !== null) {
    return { kind: "degraded", asOf };
  }
  if ((input.status === "error" || input.status === "idle") && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  if (input.status === "pending" && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  if (input.status === "success" && asOf === null) {
    return { kind: "unavailable", asOf: null };
  }
  return { kind: "unavailable", asOf };
}

export function signingAllowed(freshness: Freshness): boolean {
  return freshness.kind === "synced";
}
