"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, Hash } from "viem";
import { chainId, factoryAddress, isConfiguredAddress } from "@/lib/config";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { pinnedQuery, QUERY_RETRY, requestBookKeys } from "@/lib/query-keys";
import { classifyRpcFailure } from "@/lib/rpc";
import { bookFields, nextPageParam, presentBook, unreadBookFailure } from "@/lib/stream-book";
import { verifyPinHash } from "@/lib/protocol/pin";
import {
  loadFactoryRequestBookPage,
  type RestingRequestRow,
} from "@/lib/protocol/request-book";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { useEnumerationPin } from "./useEnumerationPin";
import type { BookPager } from "./useStreams";

export type { RestingRequestRow };

export type RequestBook = {
  requests: readonly RestingRequestRow[];
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export type RequestBookResult = ReadOutcome<RequestBook> &
  BookPager & {
    advancePin: () => Promise<void>;
  };

const idlePager: BookPager = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => undefined,
};

const idleAdvance = {
  advancePin: async () => undefined,
};

function asLendings(lending: Address | readonly Address[] | null | undefined): Address[] {
  if (!lending) return [];
  if (typeof lending === "string") return [lending];
  return [...lending];
}

function throwIfUnknownBlock(error: unknown): void {
  if (classifyRpcFailure(error) === "unknown_block") {
    throw error instanceof Error ? error : new Error("unknown block");
  }
}

export function useRequestBook(
  lending: Address | readonly Address[] | null | undefined,
  account: Address | null | undefined,
  options?: { enabled?: boolean },
): RequestBookResult {
  const lendings = asLendings(lending);
  const enabledFlag = options?.enabled ?? true;
  const pinState = useEnumerationPin();
  const pin = pinState.pin;
  const publicClient = usePublicClient({ chainId });
  const configured =
    enabledFlag &&
    isConfiguredAddress(account ?? null) &&
    isConfiguredAddress(factoryAddress) &&
    pin !== null &&
    publicClient !== undefined;

  const query = useInfiniteQuery({
    queryKey: requestBookKeys.factory(chainId, account, lendings, pin?.blockHash ?? null),
    queryFn: async ({ pageParam, signal }) => {
      if (!publicClient || !account || !pin) {
        throw new Error("request book page query ran without a pin");
      }
      const outcome = await loadFactoryRequestBookPage(
        publicClient,
        factoryAddress,
        lendings,
        account,
        pageParam,
        pageParam + STREAM_PAGE_SIZE,
        { signal, pin, pinMode: pinState.mode },
      );
      if (pinState.mode === "number" && outcome.status !== "unavailable") {
        const verified = await verifyPinHash(publicClient, pin);
        if (!verified.ok) {
          throw new Error(verified.message);
        }
      }
      if (outcome.status === "unavailable") {
        const message = outcome.failures[0]?.message ?? "request book page failed";
        throwIfUnknownBlock(message);
        throw new Error(message);
      }
      if (outcome.status !== "ready" && outcome.status !== "partial") {
        throw new Error("request book page did not resolve");
      }
      return {
        requests: outcome.data.requests,
        sourceCount: outcome.data.sourceCount,
        failures: [...outcome.failures],
      };
    },
    initialPageParam: 0n,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      nextPageParam(lastPageParam, lastPage.sourceCount, STREAM_PAGE_SIZE),
    enabled: configured && lendings.length > 0,
    ...pinnedQuery,
    retry: (failureCount, error) =>
      classifyRpcFailure(error) !== "unknown_block" && failureCount < QUERY_RETRY,
  });

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

  const pageStamp = useRef<{ blockNumber: bigint; blockHash: Hash } | null>(null);
  if (pin && query.data && !query.isPlaceholderData) {
    pageStamp.current = { blockNumber: pin.blockNumber, blockHash: pin.blockHash };
  }
  const stamp = query.isPlaceholderData ? pageStamp.current : pin;

  return useMemo(() => {
    const meta = {
      dataUpdatedAt: pinState.headUpdatedAt || query.dataUpdatedAt,
      blockNumber: stamp?.blockNumber,
      blockHash: stamp?.blockHash,
    };
    const pinControls = { advancePin: pinState.advancePin };
    if (!configured) {
      return { ...loadingOutcome<RequestBook>(undefined, meta), ...idlePager, ...idleAdvance };
    }
    if (lendings.length === 0) {
      const book: RequestBook = {
        requests: [],
        ...bookFields({
          sourceCount: 0n,
          renderCount: 0,
          complete: true,
          unresolvedFailures: false,
        }),
      };
      return { ...readyOutcome(book, meta), ...idlePager, ...pinControls };
    }
    if (query.isLoading && !query.data) {
      return { ...loadingOutcome<RequestBook>(undefined, meta), ...pager, ...pinControls };
    }
    if (query.isError) {
      const sourceCount = query.data?.pages[0]?.sourceCount ?? 0n;
      const requests = query.data?.pages.flatMap((page) => [...page.requests]) ?? [];
      const book =
        query.data === undefined
          ? undefined
          : {
              requests,
              ...bookFields({
                sourceCount,
                renderCount: requests.length,
                complete: false,
                unresolvedFailures: true,
              }),
            };
      return {
        ...unavailableOutcome(
          [readFailure("useRequestBook", "transport", query.error ?? "request book page failed")],
          meta,
          book,
        ),
        ...pager,
        ...pinControls,
      };
    }
    if (!query.data) {
      return { ...loadingOutcome<RequestBook>(undefined, meta), ...pager, ...pinControls };
    }
    const sourceCount = query.data.pages[0]?.sourceCount ?? 0n;
    const requests = query.data.pages.flatMap((page) => [...page.requests]);
    const pageFailures = query.data.pages.flatMap((page) => page.failures);
    const complete = !query.hasNextPage && !query.isFetching && pageFailures.length === 0;
    const book: RequestBook = {
      requests,
      ...bookFields({
        sourceCount,
        renderCount: requests.length,
        complete,
        unresolvedFailures: pageFailures.length > 0,
      }),
    };
    if (!complete && requests.length === 0 && pageFailures.length === 0) {
      return { ...loadingOutcome(book, meta), ...pager, ...pinControls };
    }
    const failures =
      pageFailures.length > 0 ? pageFailures : complete ? [] : [unreadBookFailure("useRequestBook")];
    return { ...presentBook(book, failures, meta), ...pager, ...pinControls };
  }, [
    configured,
    lendings.length,
    pager,
    pinState.advancePin,
    pinState.headUpdatedAt,
    query.data,
    query.dataUpdatedAt,
    query.error,
    query.hasNextPage,
    query.isError,
    query.isFetching,
    query.isLoading,
    stamp,
  ]);
}
