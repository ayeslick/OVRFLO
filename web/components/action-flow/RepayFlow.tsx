"use client";

import { useEffect, useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { symbolFor } from "@/hooks/useMarketSymbols";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { formatId, formatTokenAmount } from "@/lib/format";
import { loanOutstanding } from "@/lib/lending-math";
import { repayMax } from "@/lib/modal-logic";
import type { ActionFlowProps } from "./ActionFlowShell";
import {
  ActionFlowShell,
  AmountInput,
  ApproveTxState,
  CloseButton,
  StepIndicator,
  TxState,
  WalletChangedNotice,
  accentClass,
  formatUnits18,
  parseAmount,
} from "./ActionFlowShell";

// --- Repay form ---

export function RepayFlow({
  market,
  user,
  action,
  symbols,
  accent,
  onClose,
}: ActionFlowProps) {
  const connection = useConnection();
  const borrowerLoans = useBorrowerLoans(market.lending, user);
  const loanEntry = borrowerLoans.loans.find(({ loan }) => loan.id === action.loanId);
  const loan = loanEntry?.loan;

  const [raw, setRaw] = useState("");
  const [repayApprovedAmount, setRepayApprovedAmount] = useState(0n);
  const connectedAddress = connection.addresses?.[0];
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const repayInput = parseAmount(raw);
  const outstanding = loan ? loanOutstanding(loan) : 0n;
  const repayAmount = repayInput > outstanding && outstanding > 0n ? outstanding : repayInput;

  const { approveTx, actionTx, zeroFirst, busy } = useApprovalWriteFlows(connectedAddress, market);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setRepayApprovedAmount(0n);
  });

  const repayAllowance = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });
  // Polled, not just invalidation-driven: the wallet's ovrfloToken balance can
  // change from outside this session (a transfer elsewhere, another channel
  // draining it) with no tx of this modal's own to key an invalidation off
  // of — same reasoning as useBorrowerLoans's polling for an externally
  // closed loan.
  const balanceRead = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress), refetchInterval: 2_000 },
  });

  useEffect(() => {
    if (approveTx.hasFailed) setRepayApprovedAmount(0n);
  }, [approveTx.hasFailed]);

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const needsApproval =
    Boolean(market.lending) &&
    repayAmount > 0n &&
    (repayAllowance.data ?? 0n) < repayAmount &&
    repayApprovedAmount < repayAmount;
  const walletBalance = balanceRead.data ?? 0n;
  const validationError = repayAmount > 0n && repayAmount > walletBalance ? "INSUFFICIENT BALANCE" : null;

  const disabled =
    !market.lending || !loan || repayAmount === 0n || busy || Boolean(validationError) ||
    actionTx.isConfirmed;

  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : needsApproval ? 0 : 1;

  if (borrowerLoans.isLoading) {
    return <div className="label mono">LOADING</div>;
  }
  // `loan` itself never disappears from the read (the contract never zeroes
  // a closed loan's borrower) — closing sets `closed: true` in place. Treat
  // an externally-closed loan as not found, but not one this form's own
  // repay just closed (guarded by `actionTx.isConfirmed`), or a just-repaid
  // loan would flash "LOAN NOT FOUND" instead of the CONFIRMED state below.
  if (!loan || (loan.closed && !actionTx.isConfirmed)) {
    return <div className="label mono status-negative">LOAN NOT FOUND</div>;
  }

  return (
    <ActionFlowShell>
      <div className="label mono">LOAN {formatId(loan.id)} / OUTSTANDING {formatTokenAmount(outstanding, ovrfloSymbol)}</div>
      <AmountInput
        id="repay-amount"
        label={`AMOUNT (${ovrfloSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={ovrfloSymbol}
        max={() => setRaw(formatUnits18(repayMax(loan, walletBalance)))}
        maxDisabled={outstanding === 0n}
      />
      <div className="summary-row mono" aria-live="polite">
        REPAY {formatTokenAmount(repayAmount, ovrfloSymbol)} / REMAINING {formatTokenAmount(outstanding - repayAmount, ovrfloSymbol)}
      </div>
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || busy}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            zeroFirst.submit(market.ovrfloToken, market.lending, repayAmount, repayAllowance.data ?? 0n);
            setRepayApprovedAmount(repayAmount);
          }}
        >
          APPROVE REPAY
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending || !loan) return;
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "repayLoan",
              args: [loan.id, repayAmount],
            });
          }}
        >
          REPAY {formatTokenAmount(repayAmount, ovrfloSymbol)}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE REPAY" />
      <TxState tx={actionTx} pendingLabel="REPAY" />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </ActionFlowShell>
  );
}
