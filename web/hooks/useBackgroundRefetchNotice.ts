"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  getRefetchNotice,
  isBackgroundRefetchFailure,
  setBackgroundRefetchFailed,
  subscribeRefetchNotice,
} from "@/lib/refetch-notice";

export function useBackgroundRefetchNotice(): {
  failed: boolean;
  dismiss: () => void;
} {
  const queryClient = useQueryClient();
  const failed = useSyncExternalStore(subscribeRefetchNotice, getRefetchNotice, () => false);

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

  return {
    failed,
    dismiss: () => setBackgroundRefetchFailed(false),
  };
}
