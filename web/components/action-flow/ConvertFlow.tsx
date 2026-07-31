"use client";

import { useEffect, useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { symbolFor } from "@/hooks/useMarketSymbols";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { applySlippageDown } from "@/lib/modal-logic";
import {
  bufferedFeeApproveAmount,
  convertApprovalNeeds,
  convertValidationError,
  depositCapStatus,
  type ConvertMode,
} from "@/lib/convert";
import { formatTokenAmount } from "@/lib/format";
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

// --- Convert form (deposit, claim_matured, wrap, unwrap) ---

export function ConvertFlow({
  market,
  action,
  symbols,
  accent,
  onClose,
}: Pick<ActionFlowProps, "market" | "action" | "symbols" | "accent" | "onClose">) {
  const connection = useConnection();
  const [raw, setRaw] = useState("");
  const [ptApprovedAmount, setPtApprovedAmount] = useState(0n);
  const [underlyingApprovedAmount, setUnderlyingApprovedAmount] = useState(0n);
  const nowSeconds = useNowSeconds(true);
  const amount = parseAmount(raw);
  const mode = action.type as ConvertMode;
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const { approveTx, actionTx, zeroFirst, busy } = useApprovalWriteFlows(connectedAddress, market);
  const disabled = amount === 0n || busy || actionTx.isConfirmed;

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setPtApprovedAmount(0n);
    setUnderlyingApprovedAmount(0n);
  });

  useEffect(() => {
    if (approveTx.hasFailed) {
      setPtApprovedAmount(0n);
      setUnderlyingApprovedAmount(0n);
    }
  }, [approveTx.hasFailed]);

  const matured = nowSeconds >= market.expiryCached;

  // Deposit-cap edge state (spec: "deposit form disabled with the cap shown,
  // 0 = unlimited").
  const depositLimit = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketDepositLimits",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const totalDeposited = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketTotalDeposited",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const preview = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: amount > 0n ? [market.market, amount] : undefined,
    query: { enabled: mode === "deposit" && amount > 0n },
  });
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });
  const ptAllowance = useReadContract({
    address: market.ptToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const underlyingAllowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const spendToken = mode === "deposit" ? market.ptToken : mode === "wrap" ? market.underlying : market.ovrfloToken;
  // PT has no entry in the symbol map — it is not one of the market's named
  // tokens — so the deposit case names it directly rather than rendering blank.
  const spendSymbol = mode === "deposit" ? "PT" : mode === "wrap" ? underlyingSymbol : ovrfloSymbol;
  const balanceRead = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const depositPreview = preview.data as [bigint, bigint, bigint, bigint] | undefined;
  const feeAmount = depositPreview?.[2] ?? 0n;
  const minToUser = applySlippageDown(depositPreview?.[0] ?? 0n);
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
  const walletBalance = balanceRead.data ?? 0n;
  const capLoaded = depositLimit.data !== undefined && totalDeposited.data !== undefined;
  const capLimit = depositLimit.data ?? 0n;
  const capUsed = totalDeposited.data ?? 0n;

  const { needsPtApproval, needsUnderlyingApproval, needsApproval } = convertApprovalNeeds({
    mode,
    amount,
    feeAmount,
    ptAllowance: ptAllowance.data ?? 0n,
    ptApprovedAmount,
    underlyingAllowance: underlyingAllowance.data ?? 0n,
    underlyingApprovedAmount,
  });
  const { capRemaining, capReached, capExceeded } = depositCapStatus({ mode, amount, capLoaded, capLimit, capUsed });
  const validationError = convertValidationError({ amount, walletBalance, capExceeded, capRemaining });

  const modeDisabled =
    disabled ||
    Boolean(validationError) ||
    (mode === "deposit" && (!depositPreview || matured || !capLoaded || capReached)) ||
    (mode === "claim_matured" && !matured) ||
    (mode === "unwrap" && wrapCapacity < amount);

  const steps = needsApproval ? ["APPROVE", "SIGN", "CONFIRMED"] : ["SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? steps.length - 1 : 0;

  return (
    <ActionFlowShell>
      <AmountInput
        id="convert-amount"
        label={`AMOUNT (${spendSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={spendSymbol}
        max={() => setRaw(formatUnits18(walletBalance))}
      />
      {mode === "deposit" ? (
        <div className="summary-row mono" aria-live="polite">
          {depositPreview ? (
            <>
              TO WALLET {formatTokenAmount(depositPreview[0], ovrfloSymbol)} / STREAM{" "}
              {formatTokenAmount(depositPreview[1], ovrfloSymbol)} / FEE {formatTokenAmount(feeAmount, underlyingSymbol)}
            </>
          ) : amount > 0n ? (
            "LOADING"
          ) : (
            "—"
          )}
        </div>
      ) : null}
      {mode === "unwrap" ? (
        <div className="label mono">WRAP RESERVE {formatTokenAmount(wrapCapacity, underlyingSymbol)}</div>
      ) : null}
      {mode === "deposit" && capLoaded && capLimit > 0n ? (
        capReached ? (
          <div className="label mono status-negative">
            DEPOSIT CAP REACHED — {formatTokenAmount(capLimit, "PT")}
          </div>
        ) : (
          <div className="label mono">
            DEPOSIT CAP {formatTokenAmount(capLimit, "PT")} / REMAINING{" "}
            {formatTokenAmount(capRemaining ?? 0n, "PT")}
          </div>
        )
      ) : null}
      {mode === "claim_matured" && !matured ? (
        <div className="label mono status-negative">CLAIM ENABLES AFTER MATURITY</div>
      ) : null}
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {needsPtApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            zeroFirst.submit(market.ptToken, market.vault, amount, ptAllowance.data ?? 0n);
            setPtApprovedAmount(amount);
          }}
        >
          APPROVE PT
        </button>
      ) : needsUnderlyingApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            // Wrap approves the exact amount it spends; only the deposit fee —
            // which requotes between blocks — carries the 2% buffer (R9).
            const approveAmount = mode === "wrap" ? amount : bufferedFeeApproveAmount(feeAmount);
            zeroFirst.submit(market.underlying, market.vault, approveAmount, underlyingAllowance.data ?? 0n);
            setUnderlyingApprovedAmount(approveAmount);
          }}
        >
          APPROVE {underlyingSymbol}
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={modeDisabled}
          type="button"
          onClick={() => {
            if (mode === "deposit") {
              actionTx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "deposit",
                args: [market.market, amount, minToUser],
              });
              return;
            }
            if (mode === "claim_matured") {
              actionTx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "claim",
                args: [market.ptToken, amount],
              });
              return;
            }
            actionTx.writeContract({
              address: market.vault,
              abi: ovrfloAbi,
              functionName: mode === "wrap" ? "wrap" : "unwrap",
              args: [amount],
            });
          }}
        >
          {mode === "claim_matured" ? "CLAIM" : mode.toUpperCase()}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE" />
      <TxState tx={actionTx} pendingLabel={mode.toUpperCase()} />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </ActionFlowShell>
  );
}
