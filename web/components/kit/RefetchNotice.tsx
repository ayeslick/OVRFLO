"use client";

import { useSyncExternalStore } from "react";
import { ActionButton } from "@/components/kit/ActionButton";
import { queryClient } from "@/lib/query-client";
import { invalidateAllOnChainReads } from "@/lib/invalidate";
import {
  getRefetchNotice,
  setBackgroundRefetchFailed,
  subscribeRefetchNotice,
} from "@/lib/refetch-notice";

/** One global notice for background refetch failure — never a per-hook toast. */
export function RefetchNotice() {
  const failed = useSyncExternalStore(subscribeRefetchNotice, getRefetchNotice, () => false);
  if (!failed) return null;

  return (
    <div className="kit-refetch-notice" role="status" data-ui="UI-SHELL-REFETCH-NOTICE">
      <span>BACKGROUND REFRESH FAILED — SHOWING LAST KNOWN</span>
      <ActionButton
        onClick={() => {
          invalidateAllOnChainReads(queryClient);
          setBackgroundRefetchFailed(false);
        }}
      >
        REFRESH
      </ActionButton>
    </div>
  );
}
