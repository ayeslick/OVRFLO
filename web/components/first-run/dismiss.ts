"use client";

import { useCallback, useEffect, useState } from "react";
import { chainId } from "@/lib/config";
import { storageGet, storageSet } from "@/lib/storage";

export function firstRunDismissKey(chainIdValue: number, account: string): string {
  return `ovrflo:first-run-dismissed:${chainIdValue}:${account.toLowerCase()}`;
}

export function readFirstRunDismissed(chainIdValue: number, account: string): boolean {
  return storageGet(firstRunDismissKey(chainIdValue, account)) === "1";
}

export function writeFirstRunDismissed(chainIdValue: number, account: string): boolean {
  return storageSet(firstRunDismissKey(chainIdValue, account), "1");
}

/**
 * Per-wallet dismiss memory. Applied in an effect after first paint (W6 / B9).
 */
export function useFirstRunDismissed(account: string | undefined): {
  dismissed: boolean;
  ready: boolean;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!account) {
      setDismissed(false);
      setReady(true);
      return;
    }
    setDismissed(readFirstRunDismissed(chainId, account));
    setReady(true);
  }, [account]);

  const dismiss = useCallback(() => {
    if (!account) return;
    writeFirstRunDismissed(chainId, account);
    setDismissed(true);
  }, [account]);

  return { dismissed, ready, dismiss };
}
