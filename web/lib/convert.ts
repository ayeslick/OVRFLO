import { formatTokenAmount } from "./format";

// Pure logic for the CONVERT form (deposit/claim_matured/wrap/unwrap) — mirrors
// the lib/borrow.ts convention of one file per action-type's pure planner.

export type ConvertMode = "deposit" | "claim_matured" | "wrap" | "unwrap";

export function depositCapStatus({
  mode,
  amount,
  capLoaded,
  capLimit,
  capUsed,
}: {
  mode: ConvertMode;
  amount: bigint;
  capLoaded: boolean;
  capLimit: bigint;
  capUsed: bigint;
}) {
  // 0 = unlimited (deposit-cap convention). While the cap reads are loading,
  // deposit stays gated — an unresolved read must never render as "unlimited".
  const capRemaining = capLimit > 0n ? (capLimit > capUsed ? capLimit - capUsed : 0n) : null;
  const capReached = mode === "deposit" && capLoaded && capRemaining === 0n;
  const capExceeded =
    mode === "deposit" && capLoaded && capRemaining !== null && capRemaining > 0n && amount > capRemaining;
  return { capRemaining, capReached, capExceeded };
}

// Deposit fee approvals carry 2% headroom so a block-to-block requote of a few
// wei doesn't strand the form on a second APPROVE after the first one confirmed.
// Bounded on purpose — never `type(uint256).max`, so a stale allowance can only
// ever cover one deposit's fee drift, not an unlimited future draw.
export function bufferedFeeApproveAmount(feeAmount: bigint): bigint {
  return (feeAmount * 102n) / 100n;
}

export function convertApprovalNeeds({
  mode,
  amount,
  feeAmount,
  ptAllowance,
  ptApprovedAmount,
  underlyingAllowance,
  underlyingApprovedAmount,
}: {
  mode: ConvertMode;
  amount: bigint;
  feeAmount: bigint;
  ptAllowance: bigint;
  ptApprovedAmount: bigint;
  underlyingAllowance: bigint;
  underlyingApprovedAmount: bigint;
}) {
  const needsPtApproval = mode === "deposit" && amount > 0n && ptAllowance < amount && ptApprovedAmount < amount;
  const underlyingRequired = mode === "wrap" ? amount : feeAmount;
  const needsUnderlyingApproval =
    ((mode === "deposit" && feeAmount > 0n) || mode === "wrap") &&
    amount > 0n &&
    underlyingAllowance < underlyingRequired &&
    underlyingApprovedAmount < underlyingRequired;
  return { needsPtApproval, needsUnderlyingApproval, needsApproval: needsPtApproval || needsUnderlyingApproval };
}

export function convertValidationError({
  amount,
  walletBalance,
  capExceeded,
  capRemaining,
}: {
  amount: bigint;
  walletBalance: bigint;
  capExceeded: boolean;
  capRemaining: bigint | null;
}): string | null {
  if (amount > 0n && amount > walletBalance) return "INSUFFICIENT BALANCE";
  if (capExceeded) return `EXCEEDS DEPOSIT CAP — REMAINING ${formatTokenAmount(capRemaining ?? 0n, "PT")}`;
  return null;
}
