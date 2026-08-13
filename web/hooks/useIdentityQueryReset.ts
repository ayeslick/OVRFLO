"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { removeIdentityQueries } from "@/lib/invalidate";
import {
  isBackgroundRefetchFailure,
  setBackgroundRefetchFailed,
} from "@/lib/refetch-notice";

/**
 * App-wide identity cache hygiene plus the single background-refetch listener.
 * Forms still own their own reset via useWalletChangeReset. This component
 * renders nothing (UI-SHELL-PROVIDERS).
 */
export function useIdentityQueryReset() {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const account = connection.addresses?.[0];
  const chainIdValue = connection.chainId;
  const previous = useRef({ account, chainId: chainIdValue });

  useEffect(() => {
    const prev = previous.current;
    const accountChanged = prev.account !== undefined && account !== prev.account;
    const chainChanged = prev.chainId !== undefined && chainIdValue !== prev.chainId;
    if (accountChanged || chainChanged) {
      removeIdentityQueries(queryClient, {
        account: accountChanged ? prev.account : undefined,
        chainId: chainChanged ? prev.chainId : undefined,
      });
    }
    previous.current = { account, chainId: chainIdValue };
  }, [account, chainIdValue, queryClient]);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      if (isBackgroundRefetchFailure(event.query)) {
        setBackgroundRefetchFailed(true);
        return;
      }
      const anyFailed = cache.getAll().some((query) => isBackgroundRefetchFailure(query));
      if (!anyFailed) setBackgroundRefetchFailed(false);
    });
  }, [queryClient]);
}
