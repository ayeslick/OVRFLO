"use client";

import { useEffect, useState } from "react";

// Shared wall-clock for maturity math. Lazy init is safe because every
// consumer renders client-side only (modal bodies and expanded-row content).
// Pass `live: true` to re-tick every 30s — used where maturity must be
// re-checked while a panel stays open (SupplyForm).
export function useNowSeconds(live = false): bigint {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), 30_000);
    return () => clearInterval(id);
  }, [live]);

  return nowSeconds;
}

// Hydration-safe variant for components that render unconditionally in the
// initial page tree (e.g. MarketsTable). This app builds with
// `output: "export"` (next.config.ts), so that initial HTML is static,
// baked at `next build` time — an eager Date.now() read would embed a
// build-time value that mismatches the client's real clock at hydration.
// Null until the first client-side effect runs, matching the static
// markup exactly on first paint; consumers must handle the null case.
export function useNowSecondsHydrationSafe(): bigint | null {
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);

  useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);

  return nowSeconds;
}
