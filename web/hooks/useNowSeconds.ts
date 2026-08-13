"use client";

import { useState } from "react";
import { useClock, useClockHydrationSafe } from "./useClock";

/**
 * Eager wall-clock. Client-only trees (modals, expanded rows) that never
 * hydrate against static-export HTML. Watch surfaces in the initial page tree
 * must use `useNowSecondsHydrationSafe` / `useClockHydrationSafe`.
 *
 * `live: true` subscribes to the shared 1 Hz store (KTD6, supersedes 30s).
 * `live: false` freezes the first client sample.
 */
export function useNowSeconds(live = false): bigint {
  const clock = useClock();
  const [frozen] = useState(clock.localNow);
  return live ? clock.localNow : frozen;
}

/**
 * Hydration-safe variant for the initial page tree. Null until the first
 * client tick so static-export HTML matches first paint.
 */
export function useNowSecondsHydrationSafe(): bigint | null {
  return useClockHydrationSafe()?.localNow ?? null;
}
