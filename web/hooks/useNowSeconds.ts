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
