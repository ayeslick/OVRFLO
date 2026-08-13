import { isUserRejection, userFacingError } from "@/lib/errors";
import { truncateHash } from "./helpers";

export type WriteFlowSlice = {
  isSigning: boolean;
  isConfirming: boolean;
  isRefreshing: boolean;
  isConfirmed: boolean;
  isReverted: boolean;
  refreshFailed: boolean;
  needsReview: boolean;
  hash?: `0x${string}`;
  error: Error | null;
};

export function txStatusCopy(flow: WriteFlowSlice): { copy: string; state: string } | null {
  if (flow.needsReview) {
    return { copy: "ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN", state: "needs-review" };
  }
  if (flow.refreshFailed && flow.isConfirmed) {
    return { copy: "TRANSACTION CONFIRMED — REFRESH FAILED", state: "refresh-failed" };
  }
  if (flow.isReverted) {
    return { copy: "TRANSACTION REVERTED ON-CHAIN", state: "reverted" };
  }
  if (flow.error) {
    if (isUserRejection(flow.error)) {
      return { copy: "SIGNATURE REJECTED — SELECTIONS KEPT", state: "error" };
    }
    return { copy: userFacingError(flow.error), state: "error" };
  }
  if (flow.isSigning) return { copy: "SIGNING…", state: "signing" };
  if (flow.isConfirming) {
    return {
      copy: flow.hash ? `CONFIRMING ${truncateHash(flow.hash)}` : "CONFIRMING",
      state: "confirming",
    };
  }
  if (flow.isRefreshing) return { copy: "REFRESHING…", state: "refreshing" };
  if (flow.isConfirmed) return { copy: "CONFIRMED", state: "confirmed" };
  return null;
}
