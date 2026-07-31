"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { factoryAddress } from "@/lib/config";
import { useHeldStreamProjection } from "./useLendingProjection";
import { useOvrflos } from "./useOvrflos";

const EMPTY_STREAMS: readonly never[] = [];

/**
 * Discovers OVRFLO-origin streams from verified logs, intersects them with
 * recipient Transfer logs, then hydrates every surviving ID directly from
 * Sablier at the projection block.
 */
export function useHeldStreams(user: Address | null | undefined) {
  const registry = useOvrflos(factoryAddress);
  const vaults = useMemo(
    () => registry.vaults.map((vault) => vault.vault),
    [registry.vaults],
  );
  const projection = useHeldStreamProjection(
    vaults,
    user,
    !registry.isLoading && !registry.error && !registry.tooLarge,
  );
  const unavailable =
    Boolean(registry.error || registry.tooLarge) ||
    projection.outcome.status === "unavailable";
  return {
    streams:
      projection.outcome.status === "ready"
        ? projection.outcome.data.streams
        : EMPTY_STREAMS,
    outcome: projection.outcome,
    isLoading: registry.isLoading || projection.isLoading,
    error: registry.error ?? projection.error,
    unavailable,
  };
}
