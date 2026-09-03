import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";
import {
  type CreateChoiceOption,
  type CreateSourceOption,
  type CreateStageContext,
} from "./create-stages";

export function streamSourceId(streamId: bigint): string {
  return `stream:${streamId.toString()}`;
}

export function parseStreamSourceId(id: string | null): bigint | null {
  if (!id?.startsWith("stream:")) return null;
  try {
    return BigInt(id.slice(7));
  } catch {
    return null;
  }
}

export function uniqueUnderlyings(markets: readonly MarketInfo[]): CreateChoiceOption[] {
  const seen = new Set<string>();
  const rows: CreateChoiceOption[] = [];
  for (const market of markets) {
    const id = market.underlying.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id });
  }
  return rows;
}

export function termsForUnderlying(
  markets: readonly MarketInfo[],
  underlyingId: string | null,
  now: bigint,
): CreateChoiceOption[] {
  return markets
    .filter((market) => now < market.expiryCached)
    .filter((market) => !underlyingId || market.underlying.toLowerCase() === underlyingId)
    .map((market) => ({ id: market.market.toLowerCase() }));
}

export function aprOutcomes(aprBpsList: readonly number[]): CreateChoiceOption[] {
  return [...new Set(aprBpsList)].sort((left, right) => left - right).map((aprBps) => ({
    id: String(aprBps),
  }));
}

export function buildLoanCreateContext(args: {
  streams: readonly { streamId: bigint }[];
  markets: readonly MarketInfo[];
  selectedUnderlying: string | null;
  pickableAprs: readonly number[];
  now: bigint;
}): CreateStageContext {
  const sources: CreateSourceOption[] = args.streams.map((row) => ({
    id: streamSourceId(row.streamId),
    kind: "existing-stream",
    amountFixed: true,
  }));
  return {
    positionType: "loan",
    sources,
    underlyings: uniqueUnderlyings(args.markets),
    terms: termsForUnderlying(args.markets, args.selectedUnderlying, args.now),
    outcomes: aprOutcomes(args.pickableAprs),
  };
}

export function buildFixedCreateContext(args: {
  markets: readonly MarketInfo[];
  selectedUnderlying: string | null;
  pickableAprs: readonly number[];
  now: bigint;
}): CreateStageContext {
  const live = args.markets.filter((market) => nowLive(market, args.now));
  return {
    positionType: "fixed",
    sources: [{ id: "wallet", kind: "fresh", amountFixed: false }],
    underlyings: uniqueUnderlyings(live),
    terms: termsForUnderlying(live, args.selectedUnderlying, args.now),
    outcomes: aprOutcomes(args.pickableAprs),
  };
}

function nowLive(market: MarketInfo, now: bigint): boolean {
  return now < market.expiryCached;
}

export function marketByTerm(
  markets: readonly MarketInfo[],
  termId: string | null,
): MarketInfo | undefined {
  if (!termId) return undefined;
  return markets.find((market) => market.market.toLowerCase() === termId);
}

export function underlyingIdOf(address: Address | null | undefined): string | null {
  return address ? address.toLowerCase() : null;
}
