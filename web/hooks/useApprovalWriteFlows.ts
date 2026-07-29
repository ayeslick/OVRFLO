"use client";

import type { Address } from "viem";
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
export function useApprovalWriteFlows(user?: Address) {
  const approveTx = useWriteFlow(user);
  const actionTx = useWriteFlow(user);
  const zeroFirst = useZeroFirstApprove(approveTx);
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  return { approveTx, actionTx, zeroFirst, busy };
}
