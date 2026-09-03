"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { poolAvailableWei, type LadderModel, type ShapedRung } from "@/lib/ladder";
import { MAX_UINT128 } from "@/lib/lending-math";
import { applySlippageDown } from "@/lib/modal-logic";
import { coverDate, repayPreview, type CoverDate, type StreamSchedule } from "@/lib/payoff";
import { formatAprBps } from "@/lib/format";
import { ovrfloLendingAbi } from "@/lib/abis";
import { chainId } from "@/lib/config";
import { parseDecimalInput } from "@/lib/parse";
import { borrowKeys, readQuery } from "@/lib/query-keys";

/** Debounce the amount input only. Tick and stream changes flush immediately. */
export const QUOTE_DEBOUNCE_MS = 250;

/** MAX cap target: fill clamps to min(target, epoch liquidity, stream price cap). */
export const PREVIEW_MAX_TARGET = MAX_UINT128;

export type BorrowQuoteSnapshot = {
  block: { N: bigint; H: Hex };
  actualBorrow: bigint;
  feeAmount: bigint;
  net: bigint;
  obligation: bigint;
  /** Snapshot-derived until ticket 11 `streamsByIds` lands. */
  streamRemaining: bigint;
  /** Snapshot-derived until ticket 11 `streamsByIds` lands. */
  residual: bigint;
  aprBps: number;
  target: bigint;
  minAcceptable: bigint;
};

export type BorrowQuote = BorrowQuoteSnapshot & {
  cap: bigint;
  depth: bigint;
  fill: bigint;
  partial: boolean;
  emptyTick: boolean;
  belowFillFloor: boolean;
  saleEquivalent: boolean;
};

export type PreviewBorrowClient = Pick<PublicClient, "getBlock" | "simulateContract">;

export type PreviewBorrowOutcome = {
  emptyTick: boolean;
  actualBorrow: bigint;
  feeAmount: bigint;
  obligation: bigint;
  block: { N: bigint; H: Hex };
};

function previewTuple(
  result:
    | readonly [bigint, bigint, bigint]
    | { actualBorrow: bigint; feeAmount: bigint; obligation: bigint },
): { actualBorrow: bigint; feeAmount: bigint; obligation: bigint } {
  if (typeof result === "object" && result !== null && "actualBorrow" in result) {
    return {
      actualBorrow: result.actualBorrow,
      feeAmount: result.feeAmount,
      obligation: result.obligation,
    };
  }
  return { actualBorrow: result[0], feeAmount: result[1], obligation: result[2] };
}

function revertHex(error: unknown): Hex | null {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      return data as Hex;
    }
    if (typeof data === "object" && data !== null && "data" in data) {
      const inner = (data as { data?: unknown }).data;
      if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
        return inner as Hex;
      }
    }
  }
  return null;
}

/** Decode a previewBorrow revert. Hex fixtures are valid input. */
export function previewBorrowErrorName(error: unknown): string | null {
  if (error instanceof ContractFunctionRevertedError && error.data?.errorName) {
    return error.data.errorName;
  }
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return reverted.data.errorName;
    }
  }
  const hex = revertHex(error);
  if (!hex) return null;
  try {
    return decodeErrorResult({ abi: ovrfloLendingAbi, data: hex }).errorName;
  } catch {
    return null;
  }
}

/**
 * EmptyTick is a quote outcome, not a query failure.
 * Other reverts (including BelowMinAcceptable, which previewBorrow cannot raise) return null.
 */
export function mapPreviewBorrowError(error: unknown): {
  emptyTick: true;
  actualBorrow: 0n;
  feeAmount: 0n;
  obligation: 0n;
} | null {
  if (previewBorrowErrorName(error) !== "EmptyTick") return null;
  return { emptyTick: true, actualBorrow: 0n, feeAmount: 0n, obligation: 0n };
}

export async function readPreviewBorrow(input: {
  client: PreviewBorrowClient;
  lending: Address;
  market: Address;
  aprBps: number;
  targetBorrow: bigint;
  streamId: bigint;
  blockNumber?: bigint;
}): Promise<PreviewBorrowOutcome> {
  const block =
    input.blockNumber === undefined
      ? await input.client.getBlock({ blockTag: "latest" })
      : await input.client.getBlock({ blockNumber: input.blockNumber });
  if (block.hash === null) throw new Error("previewBorrow block has no hash");
  const blockMeta = { N: block.number, H: block.hash };
  try {
    const simulated = await input.client.simulateContract({
      address: input.lending,
      abi: ovrfloLendingAbi,
      functionName: "previewBorrow",
      args: [input.market, input.aprBps, input.targetBorrow, input.streamId],
      blockNumber: block.number,
    });
    const tuple = previewTuple(simulated.result);
    return {
      emptyTick: false,
      actualBorrow: tuple.actualBorrow,
      feeAmount: tuple.feeAmount,
      obligation: tuple.obligation,
      block: blockMeta,
    };
  } catch (error) {
    const mapped = mapPreviewBorrowError(error);
    if (mapped) return { ...mapped, block: blockMeta };
    throw error;
  }
}

export function presentQuote(input: {
  preview: PreviewBorrowOutcome;
  target: bigint;
  cap: bigint;
  depth: bigint;
  aprBps: number;
  streamRemaining: bigint;
  minLiquidity: bigint;
}): BorrowQuote {
  const actualBorrow = input.preview.actualBorrow;
  const feeAmount = input.preview.feeAmount;
  const obligation = input.preview.obligation;
  const net = actualBorrow > feeAmount ? actualBorrow - feeAmount : 0n;
  const residual =
    input.streamRemaining > obligation ? input.streamRemaining - obligation : 0n;
  return {
    block: input.preview.block,
    actualBorrow,
    feeAmount,
    net,
    obligation,
    streamRemaining: input.streamRemaining,
    residual,
    aprBps: input.aprBps,
    target: input.target,
    minAcceptable: net > 0n ? applySlippageDown(net) : 0n,
    cap: input.cap,
    depth: input.depth,
    fill: actualBorrow,
    partial: !input.preview.emptyTick && input.target > actualBorrow && actualBorrow > 0n,
    emptyTick: input.preview.emptyTick,
    belowFillFloor: actualBorrow > 0n && actualBorrow < input.minLiquidity,
    saleEquivalent: actualBorrow > 0n && obligation === input.streamRemaining,
  };
}

export function snapshotQuote(quote: BorrowQuote): BorrowQuoteSnapshot {
  return {
    block: quote.block,
    actualBorrow: quote.actualBorrow,
    feeAmount: quote.feeAmount,
    net: quote.net,
    obligation: quote.obligation,
    streamRemaining: quote.streamRemaining,
    residual: quote.residual,
    aprBps: quote.aprBps,
    target: quote.target,
    minAcceptable: quote.minAcceptable,
  };
}

/**
 * Default request post is full-or-wait. The book compares net proceeds
 * (`actualBorrow - fee`) to `minAcceptable`, so the floor is the net of a
 * full target fill, not the gross target.
 */
export function waitingPostQuote(quote: BorrowQuote, feeBps = 0): BorrowQuote {
  const fee =
    quote.actualBorrow > 0n
      ? (quote.feeAmount * quote.target) / quote.actualBorrow
      : (quote.target * BigInt(feeBps)) / 10_000n;
  const net = quote.target > fee ? quote.target - fee : 0n;
  return { ...quote, minAcceptable: net };
}

/** Compares actualBorrow, feeAmount, and obligation only — never block number. */
export function quoteDrift(frozen: BorrowQuoteSnapshot, live: BorrowQuoteSnapshot): boolean {
  return (
    frozen.actualBorrow !== live.actualBorrow ||
    frozen.feeAmount !== live.feeAmount ||
    frozen.obligation !== live.obligation
  );
}

export function useDebouncedBorrowTarget(
  amountRaw: string,
  flushKey: string,
): { debouncedRaw: string; isDebouncing: boolean } {
  const [debouncedRaw, setDebouncedRaw] = useState(amountRaw);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const flushRef = useRef(flushKey);
  const valueRef = useRef(amountRaw);

  useEffect(() => {
    const flushed = flushRef.current !== flushKey;
    flushRef.current = flushKey;
    if (flushed) {
      valueRef.current = amountRaw;
      setDebouncedRaw(amountRaw);
      setIsDebouncing(false);
      return;
    }
    if (amountRaw === valueRef.current) {
      setIsDebouncing(false);
      return;
    }
    setIsDebouncing(true);
    const timer = window.setTimeout(() => {
      valueRef.current = amountRaw;
      setDebouncedRaw(amountRaw);
      setIsDebouncing(false);
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [amountRaw, flushKey]);

  return { debouncedRaw, isDebouncing };
}

export function useBorrowPreview(input: {
  lending: Address | null;
  market: Address | null;
  streamId: bigint | null;
  aprBps: number | null;
  amountRaw: string;
  streamRemaining: bigint;
  depth: bigint;
  minLiquidity: bigint;
}): {
  quote: BorrowQuote | null;
  cap: bigint | undefined;
  isStale: boolean;
  quoteFailed: boolean;
  showDashes: boolean;
  isDebouncing: boolean;
  emptyTick: boolean;
} {
  const publicClient = usePublicClient({ chainId });
  const flushKey = `${input.streamId ?? "none"}:${input.aprBps ?? "none"}`;
  const { debouncedRaw, isDebouncing } = useDebouncedBorrowTarget(input.amountRaw, flushKey);
  const parsed = parseDecimalInput(debouncedRaw);
  const target = parsed.ok ? parsed.value : 0n;
  const selected =
    publicClient !== undefined &&
    input.lending !== null &&
    input.market !== null &&
    input.streamId !== null &&
    input.aprBps !== null;
  const quoteEnabled = selected && target > 0n;
  const capEnabled = selected;

  const capQuery = useQuery({
    queryKey: borrowKeys.quote(
      chainId,
      input.lending,
      input.market,
      input.streamId,
      input.aprBps,
      PREVIEW_MAX_TARGET,
    ),
    queryFn: () => {
      if (
        publicClient === undefined ||
        input.lending === null ||
        input.market === null ||
        input.aprBps === null ||
        input.streamId === null
      ) {
        throw new Error("previewBorrow cap query ran without a selected market");
      }
      return readPreviewBorrow({
        client: publicClient,
        lending: input.lending,
        market: input.market,
        aprBps: input.aprBps,
        targetBorrow: PREVIEW_MAX_TARGET,
        streamId: input.streamId,
      });
    },
    enabled: capEnabled,
    ...readQuery,
    // Cap must not keep another tick's MAX. Fill already keeps the last complete quote.
    placeholderData: undefined,
  });

  const quoteQuery = useQuery({
    queryKey: borrowKeys.quote(
      chainId,
      input.lending,
      input.market,
      input.streamId,
      input.aprBps,
      target,
    ),
    queryFn: () => {
      if (
        publicClient === undefined ||
        input.lending === null ||
        input.market === null ||
        input.aprBps === null ||
        input.streamId === null
      ) {
        throw new Error("previewBorrow quote query ran without a selected market");
      }
      return readPreviewBorrow({
        client: publicClient,
        lending: input.lending,
        market: input.market,
        aprBps: input.aprBps,
        targetBorrow: target,
        streamId: input.streamId,
      });
    },
    enabled: quoteEnabled,
    ...readQuery,
  });

  const capStale = capQuery.isFetching || capQuery.isPlaceholderData;
  const capReady =
    capQuery.isSuccess && !capStale && capQuery.data !== undefined;
  const cap = capReady
    ? capQuery.data.emptyTick
      ? 0n
      : capQuery.data.actualBorrow
    : undefined;
  const preview =
    quoteQuery.data !== undefined && !quoteQuery.isFetching ? quoteQuery.data : undefined;
  const presented = useMemo(() => {
    if (!preview || input.aprBps === null || cap === undefined) return null;
    return presentQuote({
      preview,
      target,
      cap,
      depth: input.depth,
      aprBps: input.aprBps,
      streamRemaining: input.streamRemaining,
      minLiquidity: input.minLiquidity,
    });
  }, [preview, target, cap, input.depth, input.aprBps, input.streamRemaining, input.minLiquidity]);

  const lastQuoteRef = useRef<BorrowQuote | null>(null);
  if (presented) lastQuoteRef.current = presented;
  const quote = presented ?? lastQuoteRef.current;
  const quoteFailed = quoteQuery.isError;
  const isStale = quoteQuery.isFetching || capStale || isDebouncing || quoteFailed;
  const emptyTick = Boolean(presented?.emptyTick || (capReady && capQuery.data?.emptyTick));
  return {
    quote,
    cap,
    isStale,
    quoteFailed,
    showDashes: quote === null,
    isDebouncing,
    emptyTick,
  };
}

export function tickDepthWei(model: LadderModel | null, aprBps: number | null, minLiquidity?: bigint): bigint {
  if (!model || aprBps === null) return 0n;
  const rung = model.rungs.find((row) => row.aprBps === aprBps) ?? null;
  return poolAvailableWei(rung, minLiquidity);
}

export function liveRungs(model: LadderModel): readonly ShapedRung[] {
  return model.pickable;
}

export function liveTickCopy(model: LadderModel): string {
  const live = liveRungs(model);
  if (live.length === 0) return "NO LIVE TICKS HAVE RESTING LIQUIDITY";
  return `LIVE TICKS: ${live.map((rung) => formatAprBps(rung.aprBps)).join(", ")}`;
}

export function ttmSeconds(end: bigint, now: bigint): bigint {
  return now >= end ? 0n : end - now;
}

export function loanCover(schedule: StreamSchedule, obligation: bigint, now: bigint): CoverDate {
  return coverDate(schedule, obligation, now);
}

export function fullRepayCoverPreview(
  schedule: StreamSchedule,
  obligation: bigint,
  now: bigint,
): { current: CoverDate; next: CoverDate } {
  return repayPreview(schedule, obligation, obligation, now);
}

/** Exact wei → decimal input so MAX round-trips through parseDecimalInput. */
export function weiToAmountInput(value: bigint, decimals = 18): string {
  if (value <= 0n) return "";
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = value % scale;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function poolFractions(draw: bigint, depth: bigint): { self: number; overrun: boolean } {
  if (depth <= 0n) return { self: 0, overrun: draw > 0n };
  if (draw <= 0n) return { self: 0, overrun: false };
  const ratioBps = (draw * 10_000n) / depth;
  const capped = ratioBps > 1_000_000n ? 1_000_000n : ratioBps;
  return { self: Number(capped) / 10_000, overrun: draw > depth };
}
