/**
 * Flow-spec eight-state grammar. LOADING is never represented as zero.
 * STALE (signing disabled until refresh) is a distinct class from LOADING.
 */

export const SURFACE_STATES = [
  "LOADING",
  "EMPTY",
  "READY",
  "STALE",
  "WALLET_PENDING",
  "CHAIN_PENDING",
  "CONFIRMED",
  "ERROR",
] as const;

export type SurfaceStateKind = (typeof SURFACE_STATES)[number];

export type SurfaceStateInput = {
  dataStatus: "loading" | "empty" | "ready" | "unavailable";
  hasLastKnown?: boolean;
  stale?: boolean;
  signingAllowed?: boolean;
  isSigning?: boolean;
  isConfirming?: boolean;
  isConfirmed?: boolean;
  error?: boolean;
};

export const SURFACE_STATE_LABEL: Record<SurfaceStateKind, string> = {
  LOADING: "LOADING",
  EMPTY: "EMPTY",
  READY: "READY",
  STALE: "STALE — SIGNING DISABLED",
  WALLET_PENDING: "WALLET PENDING",
  CHAIN_PENDING: "CHAIN PENDING",
  CONFIRMED: "CONFIRMED",
  ERROR: "ERROR",
};

export function classifySurfaceState(input: SurfaceStateInput): SurfaceStateKind {
  if (input.isConfirmed) return "CONFIRMED";
  if (input.error) return "ERROR";
  if (input.isSigning) return "WALLET_PENDING";
  if (input.isConfirming) return "CHAIN_PENDING";
  if (input.stale || input.signingAllowed === false) {
    if (input.dataStatus === "loading" && !input.hasLastKnown) return "LOADING";
    return "STALE";
  }
  if (input.dataStatus === "loading") return "LOADING";
  if (input.dataStatus === "unavailable") return "ERROR";
  if (input.dataStatus === "empty") return "EMPTY";
  return "READY";
}

/** Confirmed-empty only. A loading or unavailable read must never classify as EMPTY. */
export function confirmedEmpty(
  status: "loading" | "empty" | "ready" | "unavailable",
  count: number,
): boolean {
  return status === "ready" && count === 0;
}
