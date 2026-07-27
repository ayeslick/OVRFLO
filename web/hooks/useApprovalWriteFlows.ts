"use client";

import type { Address } from "viem";
import { useWriteFlow } from "./useWriteFlow";

// Shared shape behind every approve-then-write form (Supply, Convert, Borrow,
// AdjustRate, Repay): a separate write flow for the approval tx and the real
// action tx, plus the busy flag both gate on. Each form still owns its own
// approval predicate, steps/activeIndex, and approve-error reset — those
// genuinely vary per form (see Borrow's boolean stream-approval vs the
// amount-based approvals elsewhere).
export function useApprovalWriteFlows(user?: Address) {
  const approveTx = useWriteFlow(user);
  const actionTx = useWriteFlow(user);
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  return { approveTx, actionTx, busy };
}
