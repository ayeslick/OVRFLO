"use client";

import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  type Address,
} from "viem";
import { useProtocolBootstrap } from "./useProtocolBootstrap";
import { useEnumerationPin } from "./useEnumerationPin";
import { chainId, isConfiguredAddress, rpcUrl, ZERO_ADDRESS } from "@/lib/config";
import { MIN_STREAM_AMOUNT, STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { classifyRpcFailure } from "@/lib/rpc";
import { pinnedQuery, QUERY_RETRY, streamBookKeys } from "@/lib/query-keys";
import {
  AUTO_INELIGIBLE_PAGE_CAP,
  bookFields,
  duplicateStreamFailure,
  foldStreamIds,
  nextPageParam,
  presentBook,
  unreadBookFailure,
  windowStop,
} from "@/lib/stream-book";
import { loadStreamPage, type StreamView } from "@/lib/protocol/streams";
import { callPin, verifyPinHash, type BlockPin } from "@/lib/protocol/pin";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { MarketInfo, VaultInfo } from "@/lib/types";

export type StreamScheduleParams = {
  start: bigint;
  end: bigint;
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  cliffTime: bigint;
  isCancelable: boolean;
};

export type HydratedStream = {
  streamId: bigint;
  owner: Address;
  sender: Address;
  asset: Address;
  schedule: StreamScheduleParams;
  withdrawable: bigint;
  remaining: bigint;
  /** Lockup.Status enum from statusOf — U9 paints from this. */
  status: number;
  /** Streams lens: vault sender + ovrflo asset. Matured markets stay visible. */
  renderEligible: boolean;
  /** Borrow route: full requireEligible including SeriesMatured + MIN_STREAM_AMOUNT. */
  borrowRouteEligible: boolean;
  vault: Address | null;
  market: Address | null;
};

export type StreamBook = {
  streams: readonly HydratedStream[];
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export type BookPager = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
};

export type StreamBookResult = ReadOutcome<StreamBook> &
  BookPager & {
    advancePin: () => Promise<void>;
  };

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function throwIfUnknownBlock(error: unknown): void {
  if (classifyRpcFailure(error) === "unknown_block") {
    throw error instanceof Error ? error : new Error("unknown block");
  }
}

function throwIfUnknownBlockFailures(
  failures: readonly { message: string }[],
): void {
  for (const failure of failures) {
    throwIfUnknownBlock(failure.message);
  }
}

export type StreamMarket = Pick<
  MarketInfo,
  "vault" | "market" | "ovrfloToken" | "expiryCached"
>;

export function renderEligibleStream(input: {
  sender: Address;
  asset: Address;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
}): { eligible: boolean; vault: Address | null } {
  for (const vault of input.vaults) {
    if (
      isAddressEqual(input.sender, vault.vault) &&
      isAddressEqual(input.asset, vault.ovrfloToken)
    ) {
      return { eligible: true, vault: vault.vault };
    }
  }
  return { eligible: false, vault: null };
}

export function borrowRouteEligibleStream(input: {
  sender: Address;
  asset: Address;
  schedule: StreamScheduleParams;
  remaining: bigint;
  now: bigint;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
}): { eligible: boolean; market: Address | null } {
  const identity = renderEligibleStream(input);
  if (!identity.eligible || !identity.vault) return { eligible: false, market: null };
  if (input.schedule.isCancelable) return { eligible: false, market: null };
  if (input.schedule.cliffTime !== input.schedule.start) return { eligible: false, market: null };
  if (input.remaining < MIN_STREAM_AMOUNT) return { eligible: false, market: null };
  const market = input.markets.find(
    (row) =>
      isAddressEqual(row.vault, identity.vault!) &&
      isAddressEqual(row.ovrfloToken, input.asset) &&
      row.expiryCached === input.schedule.end &&
      input.now < row.expiryCached,
  );
  return market
    ? { eligible: true, market: market.market }
    : { eligible: false, market: null };
}

export function hydrateStreamView(
  view: StreamView,
  input: {
    vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
    markets: readonly StreamMarket[];
    now: bigint;
  },
): HydratedStream | null {
  if (!view.ok) return null;
  const remaining = view.deposited - view.withdrawn - view.refunded;
  if (remaining <= 0n || view.isDepleted) return null;
  const schedule: StreamScheduleParams = {
    start: BigInt(view.startTime),
    end: BigInt(view.endTime),
    deposited: view.deposited,
    withdrawn: view.withdrawn,
    refunded: view.refunded,
    cliffTime: BigInt(view.cliffTime),
    isCancelable: view.isCancelable,
  };
  const render = renderEligibleStream({
    sender: view.sender,
    asset: view.asset,
    vaults: input.vaults,
  });
  if (!render.eligible) return null;
  const borrow = borrowRouteEligibleStream({
    sender: view.sender,
    asset: view.asset,
    schedule,
    remaining,
    now: input.now,
    vaults: input.vaults,
    markets: input.markets,
  });
  return {
    streamId: view.streamId,
    owner: view.owner,
    sender: view.sender,
    asset: view.asset,
    schedule,
    withdrawable: view.withdrawableAmount,
    remaining,
    status: view.status,
    renderEligible: true,
    borrowRouteEligible: borrow.eligible,
    vault: render.vault,
    market: borrow.market,
  };
}

const idlePager: BookPager = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => undefined,
};

const idleAdvance = {
  advancePin: async () => undefined,
};

/**
 * Held-stream wall pager. TanStack owns pageParams. The protocol client owns
 * the page operation. Complete-set consumers must use useCompleteStreams.
 */
export function useStreams(input: {
  account: Address | null | undefined;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
  registryComplete: boolean;
  now: bigint;
  /** Present only when factory bootstrap is ready — never a null sentinel. */
  stream?: Address;
}): StreamBookResult {
  const bootstrap = useProtocolBootstrap();
  const pinState = useEnumerationPin();
  const publicClient = usePublicClient({ chainId });
  const discovered =
    input.stream ?? (bootstrap.status === "ready" ? bootstrap.stream : undefined);
  const account = input.account;
  const pin = pinState.pin;
  const lockupConfigured = isConfiguredAddress(discovered ?? null);
  const configured =
    isConfiguredAddress(account ?? null) &&
    lockupConfigured &&
    input.registryComplete &&
    pin !== null &&
    publicClient !== undefined;

  const query = useInfiniteQuery({
    queryKey: streamBookKeys.wall(
      chainId,
      discovered ?? ZERO_ADDRESS,
      account ?? ZERO_ADDRESS,
      pin?.blockHash ?? null,
    ),
    queryFn: async ({ pageParam, signal }) => {
      if (!publicClient || !discovered || !account || !pin) {
        throw new Error("stream page query ran without a pin");
      }
      const start = pageParam;
      const countedCall = await publicClient.call({
        to: discovered,
        data: encodeFunctionData({
          abi: balanceOfAbi,
          functionName: "balanceOf",
          args: [account],
        }),
        ...callPin(pin, pinState.mode),
        ...(signal ? { requestOptions: { signal } } : {}),
      });
      if (!countedCall.data || countedCall.data === "0x") {
        throw new Error("balanceOf returned empty data");
      }
      const counted = decodeFunctionResult({
        abi: balanceOfAbi,
        functionName: "balanceOf",
        data: countedCall.data,
      });
      if (counted === 0n || start >= counted) {
        return {
          start,
          stop: start,
          sourceCount: counted,
          views: [] as StreamView[],
          failures: [] as ReturnType<typeof readFailure>[],
          transportFailed: false,
        };
      }
      const stop = windowStop(start, counted, STREAM_PAGE_SIZE);
      const outcome = await loadStreamPage(
        publicClient,
        discovered,
        account,
        start,
        stop,
        pin,
        { signal, pinMode: pinState.mode, providerKey: rpcUrl },
      );
      if (pinState.mode === "number" && outcome.status !== "unavailable") {
        const verified = await verifyPinHash(publicClient, pin);
        if (!verified.ok) {
          return {
            start,
            stop,
            sourceCount: counted,
            views: [] as StreamView[],
            failures: [
              readFailure("stream-book", verified.code === "transport" ? "transport" : "invalid", verified.message),
            ],
            transportFailed: verified.code === "transport",
          };
        }
      }
      if (outcome.status === "unavailable") {
        throwIfUnknownBlockFailures(outcome.failures);
        return {
          start,
          stop,
          sourceCount: counted,
          views: outcome.data?.streams ?? [],
          failures: [...outcome.failures],
          transportFailed: outcome.failures.some((failure) => failure.code === "transport"),
        };
      }
      if (outcome.status !== "ready" && outcome.status !== "partial") {
        return {
          start,
          stop,
          sourceCount: counted,
          views: [],
          failures: [readFailure("stream-book", "incomplete", "stream page did not resolve")],
          transportFailed: false,
        };
      }
      return {
        start,
        stop,
        sourceCount: counted,
        views: [...outcome.data.streams],
        failures: outcome.status === "partial" ? [...outcome.failures] : [],
        transportFailed: false,
      };
    },
    initialPageParam: 0n,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      nextPageParam(lastPageParam, lastPage.sourceCount, STREAM_PAGE_SIZE),
    enabled: configured,
    ...pinnedQuery,
    retry: (failureCount, error) =>
      classifyRpcFailure(error) !== "unknown_block" && failureCount < QUERY_RETRY,
  });

  const wantedDepth = useRef(1);
  const autoPages = useRef(0);
  const lastPin = useRef<string | null>(null);
  const pinHash = pin?.blockHash.toLowerCase() ?? null;
  if (lastPin.current !== pinHash) {
    lastPin.current = pinHash;
    autoPages.current = 0;
  }
  if (query.data && !query.isPlaceholderData) {
    wantedDepth.current = Math.max(wantedDepth.current, query.data.pages.length);
  }

  useEffect(() => {
    if (!configured || query.isFetching || query.isFetchingNextPage) return;
    if (!query.hasNextPage) return;
    const pages = query.data?.pages ?? [];
    if (query.isPlaceholderData) return;
    if (pages.length < wantedDepth.current) {
      void query.fetchNextPage();
      return;
    }
    const renderCount = pages.reduce((sum, page) => {
      return (
        sum +
        page.views.filter((view) => hydrateStreamView(view, input) !== null).length
      );
    }, 0);
    if (renderCount === 0 && autoPages.current < AUTO_INELIGIBLE_PAGE_CAP) {
      autoPages.current += 1;
      void query.fetchNextPage();
    }
  }, [
    configured,
    input,
    query.data,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetching,
    query.isFetchingNextPage,
    query.isPlaceholderData,
  ]);

  useEffect(() => {
    if (!query.isError || !query.error) return;
    if (classifyRpcFailure(query.error) === "unknown_block") {
      void pinState.advancePin();
    }
  }, [pinState.advancePin, query.error, query.isError]);

  useEffect(() => {
    if (query.isPlaceholderData || !query.data) return;
    pinState.markFresh();
  }, [pinState.markFresh, query.data, query.isPlaceholderData]);

  const pager: BookPager = {
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      void query.fetchNextPage();
    },
  };

  const pageStamp = useRef<{ pin: BlockPin; blockTimestamp: bigint | null } | null>(null);
  if (pin && query.data && !query.isPlaceholderData) {
    pageStamp.current = { pin, blockTimestamp: pinState.blockTimestamp };
  }
  const stamp = query.isPlaceholderData ? pageStamp.current : pin
    ? { pin, blockTimestamp: pinState.blockTimestamp }
    : null;
  const meta = {
    dataUpdatedAt: pinState.headUpdatedAt || query.dataUpdatedAt,
    blockNumber: stamp?.pin.blockNumber,
    blockHash: stamp?.pin.blockHash,
    blockTimestamp: stamp?.blockTimestamp ?? undefined,
  };
  const pinControls = { advancePin: pinState.advancePin };

  if (bootstrap.status === "unavailable" && input.stream === undefined) {
    return {
      ...unavailableOutcome(
        bootstrap.failures.map((failure) =>
          readFailure("useStreams", "transport", failure.message),
        ),
        meta,
      ),
      ...idlePager,
      ...idleAdvance,
    };
  }
  if (!configured) {
    return { ...loadingOutcome<StreamBook>(undefined, meta), ...idlePager, ...idleAdvance };
  }
  if (query.isError && !query.data) {
    const message = query.error instanceof Error ? query.error.message : "stream page failed";
    return {
      ...unavailableOutcome([readFailure("useStreams", "transport", message)], meta),
      ...pager,
      ...pinControls,
    };
  }
  if (!query.data) {
    return { ...loadingOutcome<StreamBook>(undefined, meta), ...pager, ...pinControls };
  }

  const pages = query.data.pages;
  const sourceCount = pages[0]?.sourceCount ?? 0n;
  const folded = foldStreamIds(pages.map((page) => ({ streams: page.views })));
  const pageFailures = pages.flatMap((page) => page.failures);
  const transportFailed = pages.some((page) => page.transportFailed) || query.isError;
  const okFalse = pages.some((page) => page.views.some((view) => !view.ok));
  const complete =
    !query.hasNextPage &&
    !query.isFetching &&
    !transportFailed &&
    pageFailures.length === 0 &&
    folded.duplicate === null &&
    !okFalse;
  const streams: HydratedStream[] = [];
  for (const page of pages) {
    for (const view of page.views) {
      const hydrated = hydrateStreamView(view, input);
      if (hydrated) streams.push(hydrated);
    }
  }
  const fields = bookFields({
    sourceCount,
    renderCount: streams.length,
    complete,
    unresolvedFailures: pageFailures.length > 0 || folded.duplicate !== null || okFalse || transportFailed,
  });
  const book: StreamBook = { streams, ...fields };
  // An unavailable outcome only carries a book when it has rows; a defined
  // empty book would otherwise replace the caller's last-known rows.
  const bookForUnavailable = streams.length > 0 ? book : undefined;

  if (folded.duplicate !== null) {
    return {
      ...unavailableOutcome([duplicateStreamFailure(folded.duplicate)], meta, bookForUnavailable),
      ...pager,
      ...pinControls,
    };
  }
  if (transportFailed) {
    return {
      ...unavailableOutcome(
        pageFailures.length > 0
          ? pageFailures
          : [readFailure("useStreams", "transport", query.error ?? "stream page failed")],
        meta,
        bookForUnavailable,
      ),
      ...pager,
      ...pinControls,
    };
  }
  if (sourceCount === 0n && complete) {
    return { ...readyOutcome(book, meta), ...pager, ...pinControls };
  }
  if (!complete && streams.length === 0 && !query.isPlaceholderData && pageFailures.length === 0) {
    return { ...loadingOutcome(book, meta), ...pager, ...pinControls };
  }
  if ((pageFailures.length > 0 || okFalse) && streams.length === 0 && complete) {
    return {
      ...unavailableOutcome(
        pageFailures.length > 0
          ? pageFailures
          : [readFailure("useStreams", "subcall", "stream rows failed hydration")],
        meta,
        bookForUnavailable,
      ),
      ...pager,
      ...pinControls,
    };
  }
  const freshness = query.isPlaceholderData || pinState.stale ? "stale" : "fresh";
  const incompleteFailures =
    pageFailures.length > 0
      ? pageFailures
      : complete
        ? []
        : [unreadBookFailure("stream-book")];
  return {
    ...presentBook(book, incompleteFailures, meta, freshness),
    ...pager,
    ...pinControls,
  };
}
