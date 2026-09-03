"use client";

import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";
import { useWriteFlow } from "./useWriteFlow";
import { useZeroFirstApprove } from "./useZeroFirstApprove";

// Shared shape behind every approve-then-write form (Supply, Convert, Borrow,
// AdjustRate, Repay): a separate write flow for the approval tx and the real
// action tx, the busy flag both gate on, and the zero-first approval fallback
// that always wraps the approval flow. Each form still owns its own approval
// predicate, steps/activeIndex, and approve-error reset — those genuinely vary
// per form (see Borrow's boolean stream-approval vs the amount-based approvals
// elsewhere).
//
// `zeroFirst` is bound here rather than at each call site because it is derived
// entirely from `approveTx` and every consumer paired the two identically — a
// form that wired one without the other would be a bug, so the pairing is not
// the caller's to get right.
//
// `scope` is forwarded to both flows so an approval and the action it unlocks
// refresh the same market reads.
export function useApprovalWriteFlows(
  user?: Address,
  scope?: Pick<
    MarketInfo,
    | "vault"
    | "reserve"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > & { requestBook?: Address | null } | readonly Address[],
) {
  const approveTx = useWriteFlow(user, scope);
  const actionTx = useWriteFlow(user, scope);
  const zeroFirst = useZeroFirstApprove(approveTx);
  const busy =
    approveTx.isInFlight ||
    approveTx.refreshFailed ||
    actionTx.isInFlight ||
    actionTx.refreshFailed;
  return { approveTx, actionTx, zeroFirst, busy };
}
