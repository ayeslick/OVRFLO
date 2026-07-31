"use client";

import { useEffect, useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useBorrowDemand } from "@/hooks/useBorrowDemand";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { formatAprBps, formatTokenAmount } from "@/lib/format";
import { aprChoices, formatBpsPct, lenderReturnBps } from "@/lib/lending-math";
import { buildLadder } from "@/lib/router";
import { RateLadder } from "../RateLadder";
import type { ActionFlowProps } from "./ActionFlowShell";
import {
  ActionFlowShell,
  AmountInput,
  ApproveTxState,
  CloseButton,
  DemandAnnotation,
  StepIndicator,
  TxState,
  WalletChangedNotice,
  accentClass,
  demandCellCopy,
  formatUnits18,
  parseAmount,
} from "./ActionFlowShell";

// --- Supply form ---

export function SupplyFlow({
  market,
  symbols,
  accent,
  onClose,
}: Pick<ActionFlowProps, "market" | "symbols" | "accent" | "onClose">) {
  const connection = useConnection();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const [raw, setRaw] = useState("");
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const [selectedAprRaw, setSelectedAprRaw] = useState<number | null>(null);
  // Live clock: maturity is checked when the panel opens AND re-checked while
  // it stays open — a market crossing maturity mid-session closes supply.
  const nowSeconds = useNowSeconds(true);

  const amount = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
  const demandState = useBorrowDemand(market.market, connectedAddress);
  const underlyingSymbol = symbolFor(symbols, market.underlying);

  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;

  // aprMinBps may legally be 0, so "loaded" is judged by aprMaxBps (a
  // configured market always has a positive ceiling), never by the minimum.
  const ratesReady = !lending.isLoading && lending.params.aprMaxBps > 0;
  const ticks = ratesReady ? aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps) : [];
  // No `self` passed to buildLadder, so `total` already includes the lender's
  // own supply — waiting liquidity deliberately counts it.
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks);
  const aprBps =
    selectedAprRaw !== null && ticks.includes(selectedAprRaw) ? selectedAprRaw : (ticks[0] ?? null);

  const { approveTx, actionTx, zeroFirst, busy } = useApprovalWriteFlows(connectedAddress, market);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setApprovedAmount(0n);
    setSelectedAprRaw(null);
  });

  useEffect(() => {
    if (approveTx.hasFailed) setApprovedAmount(0n);
  }, [approveTx.hasFailed]);

  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });
  const balanceOf = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const allowanceAmount = allowance.data ?? 0n;
  const walletBalance = balanceOf.data ?? 0n;
  const validationError = amount > 0n && amount > walletBalance ? "INSUFFICIENT BALANCE" : null;
  const approvalCovers = allowanceAmount >= amount || approvedAmount >= amount;
  // R7/H-3: `isConfirmed` belongs in the predicate, not just the step
  // indicator. Without it `busy` drops back to false on confirmation and the
  // button re-arms with the original arguments still populated — one more
  // click submits the same transaction again.
  const disabled =
    !market.lending || aprBps === null || amount === 0n || busy || Boolean(validationError) || matured ||
    actionTx.isConfirmed;
  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : approvalCovers ? 1 : 0;

  return (
    <ActionFlowShell>
      <RateLadder
        label="SUPPLY RATE"
        rows={ladder.map((tick) => ({
          aprBps: tick.aprBps,
          cells: [
            `RETURN ${formatBpsPct(lenderReturnBps(tick.aprBps, ttmSeconds))}`,
            `WAITING ${formatTokenAmount(tick.total, underlyingSymbol)}`,
            demandCellCopy(
              demandState.status,
              demandState.demand.find((row) => row.aprBps === tick.aprBps),
              demandState.peak,
              (value) => formatTokenAmount(value, underlyingSymbol),
            ),
          ],
        }))}
        selectedAprBps={aprBps}
        onSelect={setSelectedAprRaw}
        truncated={liquidity.tooLarge}
        emptyText="LOADING RATES"
      />
      <DemandAnnotation status={demandState.status} />
      <AmountInput
        id="supply-amount"
        label={`AMOUNT (${underlyingSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={underlyingSymbol}
        max={() => setRaw(formatUnits18(walletBalance))}
      />
      {matured ? <div className="label mono status-negative">MARKET MATURED — SUPPLY CLOSED</div> : null}
      {/* R35/M-3: a lender cannot choose which way their liquidity is consumed —
          a borrower may pledge a stream against it, or sell one into it outright
          — and nothing said so before submitting. The two outcomes differ in
          what the lender ends up holding, so it belongs before the decision, not
          after. */}
      <div className="label mono">
        LIQUIDITY MAY BE FILLED AS A LOAN OR AS AN OUTRIGHT STREAM PURCHASE — YOU CANNOT RESTRICT IT TO ONE
      </div>
      <div className="summary-row mono" aria-live="polite">
        SUPPLY {formatTokenAmount(amount, underlyingSymbol)} @ {aprBps !== null ? formatAprBps(aprBps) : "—"}
      </div>
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {!approvalCovers ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            zeroFirst.submit(market.underlying, market.lending, amount, allowanceAmount);
            setApprovedAmount(amount);
          }}
        >
          APPROVE
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending || aprBps === null) return;
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "supplyLiquidity",
              args: [market.market, aprBps, amount],
            });
          }}
        >
          SUPPLY @ {aprBps !== null ? formatAprBps(aprBps) : "—"}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE" />
      <TxState tx={actionTx} pendingLabel="SUPPLY" />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </ActionFlowShell>
  );
}
