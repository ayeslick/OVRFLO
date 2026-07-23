"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { userFacingError } from "@/lib/errors";
import { formatAprBps, formatTokenAmount } from "@/lib/format";
import { loanOutstanding } from "@/lib/lending-math";
import {
  applySlippageDown,
  borrowQuoteCopy,
  chooseSellNowLiquidity,
  isSeriesMatchedStream,
  staleBatchCopy,
} from "@/lib/modal-logic";
import { lendingKeys, ovrfloKeys, streamKeys } from "@/lib/query-keys";
import type { Loan, MarketInfo } from "@/lib/types";
import { useWriteFlow } from "@/hooks/useWriteFlow";

type Props = {
  market: MarketInfo | null;
  loan?: Loan;
};

export function ActionPanel({ market, loan }: Props) {
  if (!market) {
    return (
      <div className="callout mono empty">
        SELECT A MARKET TO ENABLE VAULT AND LENDING ACTIONS
      </div>
    );
  }

  return (
    <div className="section" style={{ display: "grid", gap: "1rem" }}>
      <div className="metric-grid">
        <div className="metric">
          <div className="label mono">VAULT</div>
          <div className="metric-value mono">{market.ovrfloToken.slice(0, 6)}…{market.ovrfloToken.slice(-4)}</div>
        </div>
        <div className="metric">
          <div className="label mono">LENDING</div>
          <div className="metric-value mono">{market.lending ? "DEPLOYED" : "NOT DEPLOYED"}</div>
        </div>
        <div className="metric">
          <div className="label mono">MARKET FEE</div>
          <div className="metric-value mono">{formatAprBps(market.feeBps)}</div>
        </div>
      </div>
      <div className="panels">
        <SupplyLiquidityForm market={market} />
        <VaultConversionForm market={market} />
        <StreamActionsForm market={market} loan={loan} />
      </div>
    </div>
  );
}

function SupplyLiquidityForm({ market }: { market: MarketInfo }) {
  const connection = useConnection();
  const lending = useLending(market.lending);
  const [raw, setRaw] = useState("");
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const amount = parseAmount(raw);
  const aprBps = lending.params.aprMinBps || 1000;
  const invalidateKeys = useMemo(
    () => [lendingKeys.liquidity(market.lending), ovrfloKeys.markets()],
    [market.lending],
  );
  const tx = useWriteFlow(invalidateKeys);
  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] && market.lending ? [connection.addresses[0], market.lending] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0] && market.lending) },
  });
  const allowanceAmount = allowance.data ?? 0n;
  const approvalCovers = allowanceAmount >= amount || approvedAmount >= amount;
  const disabled = !market.lending || amount === 0n || tx.isSigning || tx.isConfirming;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="label mono">LENDING</div>
        <h3>Supply liquidity</h3>
      </div>
      <div className="panel-body form-grid">
        <input className="input mono" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="50.00 wstETH" />
        <div className="summary-row mono">
          LIQUIDITY {formatTokenAmount(amount, "wstETH")} @ {formatAprBps(aprBps)}
        </div>
        <div className="label mono">[1] APPROVE &nbsp; [2] SIGN &nbsp; [3] CONFIRMED</div>
        {!approvalCovers ? (
          <button
            className="button button-gold mono"
            disabled={disabled}
            type="button"
            onClick={() => {
              if (!market.lending) return;
              tx.writeContract({
                address: market.underlying,
                abi: erc20Abi,
                functionName: "approve",
                args: [market.lending, amount],
              });
              setApprovedAmount(amount);
            }}
          >
            APPROVE
          </button>
        ) : (
          <button
            className="button button-gold mono"
            disabled={disabled}
            type="button"
            onClick={() => {
              if (!market.lending) return;
              tx.writeContract({
                address: market.lending,
                abi: ovrfloLendingAbi,
                functionName: "supplyLiquidity",
                args: [market.market, aprBps, amount],
              });
            }}
          >
            SUPPLY @ {formatAprBps(aprBps)}
          </button>
        )}
        <TxState tx={tx} />
      </div>
    </div>
  );
}

function VaultConversionForm({ market }: { market: MarketInfo }) {
  const connection = useConnection();
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<"deposit" | "claim" | "wrap" | "unwrap">("deposit");
  const [ptApprovedAmount, setPtApprovedAmount] = useState(0n);
  const [underlyingApprovedAmount, setUnderlyingApprovedAmount] = useState(0n);
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  const amount = parseAmount(raw);
  const tx = useWriteFlow([ovrfloKeys.markets(), lendingKeys.borrowerLoans(market.lending)]);
  const disabled = amount === 0n || tx.isSigning || tx.isConfirming;
  useEffect(() => {
    setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
  }, []);
  const matured = nowSeconds !== null && nowSeconds >= market.expiryCached;
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
    args: connection.addresses?.[0] ? [connection.addresses[0], market.vault] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0]) },
  });
  const underlyingAllowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] ? [connection.addresses[0], market.vault] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0]) },
  });
  const depositPreview = preview.data as [bigint, bigint, bigint] | undefined;
  const feeAmount = depositPreview?.[2] ?? 0n;
  const needsPtApproval =
    mode === "deposit" && amount > 0n && (ptAllowance.data ?? 0n) < amount && ptApprovedAmount < amount;
  const needsUnderlyingApproval =
    ((mode === "deposit" && feeAmount > 0n) || mode === "wrap") &&
    amount > 0n &&
    (underlyingAllowance.data ?? 0n) < (mode === "wrap" ? amount : feeAmount) &&
    underlyingApprovedAmount < (mode === "wrap" ? amount : feeAmount);
  const minToUser = applySlippageDown(depositPreview?.[0] ?? 0n);
  const modeDisabled =
    disabled ||
    (mode === "deposit" && (!depositPreview || matured)) ||
    (mode === "claim" && !matured) ||
    (mode === "unwrap" && (wrappedUnderlying.data ?? 0n) < amount);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="label mono">CONVERT</div>
        <h3>Wrap / unwrap</h3>
      </div>
      <div className="panel-body form-grid">
        <select
          className="input mono"
          value={mode}
          onChange={(event) => setMode(event.target.value as "deposit" | "claim" | "wrap" | "unwrap")}
        >
          <option value="deposit">DEPOSIT PT → ovrfloToken + stream</option>
          <option value="claim">CLAIM matured PT</option>
          <option value="wrap">WRAP wstETH → ovrfloToken</option>
          <option value="unwrap">UNWRAP ovrfloToken → wstETH</option>
        </select>
        <input className="input mono" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="1.00" />
        {mode === "deposit" && depositPreview ? (
          <div className="summary-row mono">
            TO WALLET {formatTokenAmount(depositPreview[0], "ovrflo")} / STREAM{" "}
            {formatTokenAmount(depositPreview[1], "ovrflo")} / FEE {formatTokenAmount(feeAmount, "wstETH")}
          </div>
        ) : null}
        {mode === "unwrap" ? (
          <div className="label mono">UNWRAP CAPACITY {formatTokenAmount(wrappedUnderlying.data ?? 0n, "wstETH")}</div>
        ) : null}
        {needsPtApproval ? (
          <button
            className="button mono"
            disabled={disabled}
            type="button"
            onClick={() => {
              tx.writeContract({
                address: market.ptToken,
                abi: erc20Abi,
                functionName: "approve",
                args: [market.vault, amount],
              });
              setPtApprovedAmount(amount);
            }}
          >
            APPROVE PT
          </button>
        ) : needsUnderlyingApproval ? (
          <button
            className="button mono"
            disabled={disabled}
            type="button"
            onClick={() => {
              const approveAmount = mode === "wrap" ? amount : feeAmount;
              tx.writeContract({
                address: market.underlying,
                abi: erc20Abi,
                functionName: "approve",
                args: [market.vault, approveAmount],
              });
              setUnderlyingApprovedAmount(approveAmount);
            }}
          >
            APPROVE wstETH
          </button>
        ) : (
        <button
          className="button mono"
          disabled={modeDisabled}
          type="button"
          onClick={() => {
            if (mode === "deposit") {
              tx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "deposit",
                args: [market.market, amount, minToUser],
              });
              return;
            }
            if (mode === "claim") {
              tx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "claim",
                args: [market.ptToken, amount],
              });
              return;
            }
            tx.writeContract({
              address: market.vault,
              abi: ovrfloAbi,
              functionName: mode,
              args: [amount],
            });
          }}
        >
          {mode.toUpperCase()}
        </button>
        )}
        <div className="label mono">
          {mode === "claim"
            ? matured
              ? "MATURED CLAIM BURNS ovrfloToken FOR PT"
              : "CLAIM ENABLES AFTER MATURITY"
            : "APPROVE → SIGN → RECEIPT → REFRESH"}
        </div>
        <TxState tx={tx} />
      </div>
    </div>
  );
}

function StreamActionsForm({ market, loan }: { market: MarketInfo; loan?: Loan }) {
  const connection = useConnection();
  const [streamId, setStreamId] = useState("");
  const [borrowRaw, setBorrowRaw] = useState("");
  const [repayRaw, setRepayRaw] = useState("");
  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const [repayApprovedAmount, setRepayApprovedAmount] = useState(0n);
  const parsedStreamId = parseBigInt(streamId);
  const borrowAmount = parseAmount(borrowRaw);
  const repayInput = parseAmount(repayRaw);
  const tx = useWriteFlow([
    streamKeys.held(connection.addresses?.[0]),
    lendingKeys.borrowerLoans(market.lending, connection.addresses?.[0]),
    lendingKeys.lenderPools(market.lending, connection.addresses?.[0]),
    lendingKeys.liquidity(market.lending),
  ]);
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const streams = useHeldStreams(connection.addresses?.[0]);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));
  const aprBps = lending.params.aprMinBps || 1000;
  const recipient = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getRecipient",
    args: parsedStreamId ? [parsedStreamId] : undefined,
    query: { enabled: parsedStreamId !== null },
  });
  const connectedAddress = connection.addresses?.[0]?.toLowerCase();
  const recipientMatches = !parsedStreamId || recipient.data?.toLowerCase() === connectedAddress;
  const outstanding = loan ? loanOutstanding(loan) : 0n;
  const repayAmount = repayInput > outstanding && outstanding > 0n ? outstanding : repayInput;
  const quote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args:
      market.lending && parsedStreamId && borrowAmount > 0n
        ? [market.market, parsedStreamId, aprBps, borrowAmount]
        : undefined,
    query: { enabled: Boolean(market.lending && parsedStreamId && borrowAmount > 0n) },
  });
  const sellQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: market.lending && parsedStreamId ? [market.market, parsedStreamId, aprBps, 0n] : undefined,
    query: { enabled: Boolean(market.lending && parsedStreamId) },
  });
  const gather = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "gatherLiquidity",
    args:
      market.lending && parsedStreamId && connection.addresses?.[0] && borrowAmount > 0n
        ? [market.market, aprBps, borrowAmount, 1n, connection.addresses[0]]
        : undefined,
    query: { enabled: Boolean(market.lending && parsedStreamId && connection.addresses?.[0] && borrowAmount > 0n) },
  });
  const approved = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getApproved",
    args: parsedStreamId ? [parsedStreamId] : undefined,
    query: { enabled: parsedStreamId !== null },
  });
  const approvedForAll = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "isApprovedForAll",
    args: connection.addresses?.[0] && market.lending ? [connection.addresses[0], market.lending] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0] && market.lending) },
  });
  const repayAllowance = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] && market.lending ? [connection.addresses[0], market.lending] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0] && market.lending) },
  });
  const quoteData = quote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const sellQuoteData = sellQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const gatherData = gather.data as [bigint[], boolean] | undefined;
  const positionsAtRate = liquidity.liquidity.filter(
    (position) => position.market.toLowerCase() === market.market.toLowerCase() && position.aprBps === aprBps,
  );
  const sellPosition = sellQuoteData
    ? chooseSellNowLiquidity({ positions: positionsAtRate, market, grossPrice: sellQuoteData[0] })
    : undefined;
  const streamApproved =
    Boolean(parsedStreamId && streamApprovedId === parsedStreamId) ||
    Boolean(market.lending && approved.data?.toLowerCase() === market.lending.toLowerCase()) ||
    approvedForAll.data === true;
  const needsRepayApproval =
    Boolean(market.lending) &&
    repayAmount > 0n &&
    (repayAllowance.data ?? 0n) < repayAmount &&
    repayApprovedAmount < repayAmount;
  const staleCopy = tx.error instanceof Error ? staleBatchCopy(tx.error.message) : null;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="label mono">STREAMS</div>
        <h3>Claim / repay / close</h3>
      </div>
      <div className="panel-body form-grid">
        <select className="input mono" value={streamId} onChange={(event) => setStreamId(event.target.value)}>
          <option value="">STREAM ID</option>
          {eligibleStreams.map((stream) => (
            <option key={stream.streamId.toString()} value={stream.streamId.toString()}>
              {stream.streamId.toString()} / {formatTokenAmount(stream.deposited - stream.withdrawn, "ovrflo")}
            </option>
          ))}
        </select>
        <input className="input mono" value={streamId} onChange={(event) => setStreamId(event.target.value)} placeholder="OR ENTER STREAM ID" />
        <button
          className="button button-cyan mono"
          disabled={!parsedStreamId || !recipientMatches || tx.isSigning || tx.isConfirming}
          type="button"
          onClick={() => {
            if (!parsedStreamId || !connection.addresses?.[0]) return;
            tx.writeContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "withdrawMax",
              args: [parsedStreamId, connection.addresses[0]],
            });
          }}
        >
          CLAIM STREAM
        </button>
        <div className="label mono">
          CLAIM PREFLIGHT: {recipientMatches ? "RECIPIENT OK" : "CONNECTED WALLET IS NOT RECIPIENT"}
        </div>
        <input
          className="input mono"
          value={borrowRaw}
          onChange={(event) => setBorrowRaw(event.target.value)}
          placeholder="BORROW TARGET"
        />
        {quoteData ? (
          <div className="summary-row mono">
            NET {formatTokenAmount(quoteData[3], "wstETH")} / OBLIGATION{" "}
            {formatTokenAmount(quoteData[1], "ovrflo")} / RESIDUAL {formatTokenAmount(quoteData[4], "ovrflo")}
          </div>
        ) : null}
        <div className="label mono">
          {borrowQuoteCopy({
            gatheredIds: gatherData?.[0] ?? [],
            sufficient: gatherData?.[1] ?? false,
            positionsAtRate,
            borrower: connection.addresses?.[0],
          })}
        </div>
        {!streamApproved && parsedStreamId ? (
          <button
            className="button button-cyan mono"
            disabled={!market.lending || tx.isSigning || tx.isConfirming}
            type="button"
            onClick={() => {
              if (!market.lending || !parsedStreamId) return;
              tx.writeContract({
                address: SABLIER_LOCKUP_ADDRESS,
                abi: sablierLockupAbi,
                functionName: "approve",
                args: [market.lending, parsedStreamId],
              });
              setStreamApprovedId(parsedStreamId);
            }}
          >
            APPROVE STREAM
          </button>
        ) : (
          <button
            className="button button-cyan mono"
            disabled={
              !market.lending ||
              !parsedStreamId ||
              !quoteData ||
              !gatherData?.[1] ||
              borrowAmount === 0n ||
              tx.isSigning ||
              tx.isConfirming
            }
            type="button"
            onClick={() => {
              if (!market.lending || !parsedStreamId || !gatherData || !quoteData) return;
              tx.writeContract({
                address: market.lending,
                abi: ovrfloLendingAbi,
                functionName: "createBorrowerLoanPool",
                args: [gatherData[0], parsedStreamId, borrowAmount, applySlippageDown(quoteData[3])],
              });
            }}
          >
            BORROW AGAINST STREAM
          </button>
        )}
        <button
          className="button button-gold mono"
          disabled={!market.lending || !parsedStreamId || !sellPosition || !sellQuoteData || !streamApproved}
          type="button"
          onClick={() => {
            if (!market.lending || !parsedStreamId || !sellPosition || !sellQuoteData) return;
            tx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "sellStreamToLiquidity",
              args: [sellPosition.id, parsedStreamId, applySlippageDown(sellQuoteData[3])],
            });
          }}
        >
          SELL NOW {sellQuoteData ? formatTokenAmount(sellQuoteData[3], "wstETH") : ""}
        </button>
        {loan ? (
          <>
            <input
              className="input mono"
              value={repayRaw}
              onChange={(event) => setRepayRaw(event.target.value)}
              placeholder="REPAY AMOUNT"
            />
            <button className="button mono" type="button" onClick={() => setRepayRaw(formatUnits18(outstanding))}>
              MAX REPAY
            </button>
            {needsRepayApproval ? (
              <button
                className="button button-cyan mono"
                disabled={!market.lending || tx.isSigning || tx.isConfirming}
                type="button"
                onClick={() => {
                  if (!market.lending) return;
                  tx.writeContract({
                    address: market.ovrfloToken,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [market.lending, repayAmount],
                  });
                  setRepayApprovedAmount(repayAmount);
                }}
              >
                APPROVE REPAY
              </button>
            ) : (
            <button
              className="button button-cyan mono"
              disabled={!market.lending || tx.isSigning || tx.isConfirming || repayAmount === 0n}
              type="button"
              onClick={() => {
                if (!market.lending) return;
                tx.writeContract({
                  address: market.lending,
                  abi: ovrfloLendingAbi,
                  functionName: "repayLoan",
                  args: [loan.id, repayAmount],
                });
              }}
            >
              REPAY {formatTokenAmount(repayAmount, "ovrflo")}
            </button>
            )}
            <button
              className="button button-cyan mono"
              disabled={!market.lending || tx.isSigning || tx.isConfirming || loan.closed}
              type="button"
              onClick={() => {
                if (!market.lending) return;
                tx.writeContract({
                  address: market.lending,
                  abi: ovrfloLendingAbi,
                  functionName: "closeLoan",
                  args: [loan.id],
                });
              }}
            >
              CLOSE IF ACCRUED
            </button>
          </>
        ) : (
          <div className="empty mono">NO ACTIVE LOAN SELECTED</div>
        )}
        {staleCopy ? <div className="label mono status-warning">{staleCopy}</div> : null}
        <TxState tx={tx} />
      </div>
    </div>
  );
}

function TxState({ tx }: { tx: ReturnType<typeof useWriteFlow> }) {
  if (tx.isSigning) return <div className="label mono status-warning">SIGNING</div>;
  if (tx.isConfirming) return <div className="label mono status-warning">CONFIRMING {tx.hash}</div>;
  if (tx.isConfirmed) return <div className="label mono status-positive">CONFIRMED</div>;
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

function parseAmount(raw: string) {
  try {
    if (!raw.trim()) return 0n;
    return parseUnits(raw.trim(), 18);
  } catch {
    return 0n;
  }
}

function parseBigInt(raw: string) {
  try {
    if (!raw.trim()) return null;
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

function formatUnits18(value: bigint) {
  return formatUnits(value, 18);
}
