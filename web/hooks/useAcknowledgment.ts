"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { chainId } from "@/lib/config";
import { acknowledgmentKey, storageGet, storageSet } from "@/lib/storage";

/**
 * One-time risk acknowledgment per wallet. Applied in an effect after first
 * paint — never a render-read of localStorage (W6 / B9).
 */
export function useAcknowledgment(): {
  acknowledged: boolean;
  ready: boolean;
  acknowledge: () => void;
} {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const [acknowledged, setAcknowledged] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!account) {
      setAcknowledged(false);
      setReady(true);
      return;
    }
    const stored = storageGet(acknowledgmentKey(chainId, account));
    setAcknowledged(stored === "1");
    setReady(true);
  }, [account]);

  const acknowledge = useCallback(() => {
    if (!account) return;
    storageSet(acknowledgmentKey(chainId, account), "1");
    setAcknowledged(true);
  }, [account]);

  return { acknowledged, ready, acknowledge };
}
