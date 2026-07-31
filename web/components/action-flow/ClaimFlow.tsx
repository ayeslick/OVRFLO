"use client";

import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { formatId } from "@/lib/format";
import { MAX_UINT128 } from "@/lib/lending-math";
import type { ActionFlowProps } from "./ActionFlowShell";
import {
  ActionFlowShell,
  CloseButton,
  StepIndicator,
  TxState,
  WalletChangedNotice,
  accentClass,
} from "./ActionFlowShell";

// --- Simple action form (withdraw, claim_share, claim_stream, close) ---

export function SimpleActionFlow({
  market,
  user,
  action,
  accent,
  onClose,
}: Pick<ActionFlowProps, "market" | "user" | "action" | "accent" | "onClose">) {
  const connection = useConnection();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const connectedAddress = connection.addresses?.[0];

  const tx = useWriteFlow(connectedAddress ?? user, market);

  const guard = useWalletChangeReset(connectedAddress, () => setPendingLabel(null));

  useEffect(() => {
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const steps = ["SIGN", "CONFIRMED"];
  const activeIndex = tx.isConfirmed || tx.isConfirming ? 1 : 0;

  let summary = "";
  let buttonText = "";
  const writeArgs: (() => void) | null = (() => {
    switch (action.type) {
      case "withdraw":
        if (action.positionId === undefined) return null;
        summary = `WITHDRAW LIQUIDITY ${formatId(action.positionId)}`;
        buttonText = "WITHDRAW";
        return () => {
          if (!market.lending) return;
          setPendingLabel("WITHDRAW");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "withdrawLiquidity",
            args: [action.positionId!],
          });
        };
      case "claim_share":
        if (action.positionId === undefined) return null;
        summary = `CLAIM SHARE POOL ${formatId(action.positionId)}`;
        buttonText = "CLAIM SHARE";
        return () => {
          if (!market.lending) return;
          setPendingLabel("CLAIM SHARE");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "claimLoanPoolShare",
            args: [action.positionId!, MAX_UINT128],
          });
        };
      case "claim_stream":
        if (action.streamId === undefined) return null;
        summary = `CLAIM STREAM ${formatId(action.streamId)}`;
        buttonText = "CLAIM STREAM";
        return () => {
          if (!connectedAddress) return;
          setPendingLabel("CLAIM STREAM");
          tx.writeContract({
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "withdrawMax",
            args: [action.streamId!, connectedAddress],
          });
        };
      case "close":
        if (action.loanId === undefined) return null;
        summary = `CLOSE LOAN ${formatId(action.loanId)}`;
        buttonText = "CLOSE LOAN";
        return () => {
          if (!market.lending) return;
          setPendingLabel("CLOSE");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "closeLoan",
            args: [action.loanId!],
          });
        };
      default:
        return null;
    }
  })();

  return (
    <ActionFlowShell>
      <div className="summary-row mono" aria-live="polite">
        {summary}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={tx.hasFailed} accent={accent} />
      <button
        className={`button ${accentClass(accent)} mono`}
        disabled={
          !writeArgs ||
          tx.isInFlight ||
          tx.isConfirmed ||
          tx.refreshFailed
        }
        type="button"
        onClick={() => writeArgs?.()}
      >
        {buttonText}
      </button>
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </ActionFlowShell>
  );
}

export function ClaimFlow({
  market,
  user,
  action,
  accent,
  onClose,
}: Pick<ActionFlowProps, "market" | "user" | "action" | "accent" | "onClose">) {
  return <SimpleActionFlow market={market} user={user} action={action} accent={accent} onClose={onClose} />;
}
