"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { chainId, isConfiguredAddress } from "@/lib/config";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { lenderBookKeys, readQuery } from "@/lib/query-keys";
import { bookFields, nextPageParam, presentBook, unreadBookFailure } from "@/lib/stream-book";
import {
  loadFactoryLenderPage,
  paginateLoansOf,
  type LenderPositionRow,
  type LoanShare,
} from "@/lib/protocol/lending";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { BookPager } from "./useStreams";

export type { LenderPositionRow, LoanShare };
export { paginateLoansOf };

export type LenderBook = {
  positions: readonly LenderPositionRow[];
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export type LenderBookResult = ReadOutcome<LenderBook> & BookPager;

const idlePager: BookPager = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => undefined,
};

function asLendings(lending: Address | readonly Address[] | null | undefined): Address[] {
  if (!lending) return [];
  if (typeof lending === "string") return [lending];
  return [...lending];
}

export function useLenderBook(
  lending: Address | readonly Address[] | null | undefined,
  account: Address | null | undefined,
  options?: { enabled?: boolean },
): LenderBookResult {
  const lendings = asLendings(lending);
  const enabledFlag = options?.enabled ?? true;
  const publicClient = usePublicClient({ chainId });
  const configured =
    enabledFlag &&
    isConfiguredAddress(account ?? null) &&
    publicClient !== undefined;

  const query = useInfiniteQuery({
    queryKey: lenderBookKeys.factory(chainId, account, lendings),
    queryFn: async ({ pageParam, signal }) => {
      if (!publicClient || !account) throw new Error("lender page query ran unconfigured");
      const outcome = await loadFactoryLenderPage(
        publicClient,
        lendings,
        account,
        pageParam,
        pageParam + STREAM_PAGE_SIZE,
        { signal },
      );
      if (outcome.status === "unavailable") {
        throw new Error(outcome.failures[0]?.message ?? "lender page failed");
      }
      if (outcome.status !== "ready" && outcome.status !== "partial") {
        throw new Error("lender page did not resolve");
      }
      return {
        positions: outcome.data.positions,
        sourceCount: outcome.data.sourceCount,
        failures: [...outcome.failures],
      };
    },
    initialPageParam: 0n,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      nextPageParam(lastPageParam, lastPage.sourceCount, STREAM_PAGE_SIZE),
    enabled: configured && lendings.length > 0,
    ...readQuery,
  });

  const pager: BookPager = {
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      void query.fetchNextPage();
    },
  };

  return useMemo(() => {
    const meta = query.dataUpdatedAt > 0 ? { dataUpdatedAt: query.dataUpdatedAt } : {};
    if (!configured) return { ...loadingOutcome<LenderBook>(undefined, meta), ...idlePager };
    if (lendings.length === 0) {
      const book: LenderBook = {
        positions: [],
        ...bookFields({
          sourceCount: 0n,
          renderCount: 0,
          complete: true,
          unresolvedFailures: false,
        }),
      };
      return { ...readyOutcome(book, meta), ...idlePager };
    }
    if (query.isLoading && !query.data) {
      return { ...loadingOutcome<LenderBook>(undefined, meta), ...pager };
    }
    if (query.isError) {
      const sourceCount = query.data?.pages[0]?.sourceCount ?? 0n;
      const positions = query.data?.pages.flatMap((page) => [...page.positions]) ?? [];
      const book =
        query.data === undefined
          ? undefined
          : {
              positions,
              ...bookFields({
                sourceCount,
                renderCount: positions.length,
                complete: false,
                unresolvedFailures: true,
              }),
            };
      return {
        ...unavailableOutcome(
          [readFailure("useLenderBook", "transport", query.error ?? "lender page failed")],
          meta,
          book,
        ),
        ...pager,
      };
    }
    if (!query.data) {
      return { ...loadingOutcome<LenderBook>(undefined, meta), ...pager };
    }
    const sourceCount = query.data.pages[0]?.sourceCount ?? 0n;
    const positions = query.data.pages.flatMap((page) => [...page.positions]);
    const pageFailures = query.data.pages.flatMap((page) => page.failures);
    const complete = !query.hasNextPage && !query.isFetching && pageFailures.length === 0;
    const book: LenderBook = {
      positions,
      ...bookFields({
        sourceCount,
        renderCount: positions.length,
        complete,
        unresolvedFailures: pageFailures.length > 0,
      }),
    };
    if (!complete && positions.length === 0 && pageFailures.length === 0) {
      return { ...loadingOutcome(book, meta), ...pager };
    }
    const failures =
      pageFailures.length > 0 ? pageFailures : complete ? [] : [unreadBookFailure("useLenderBook")];
    return { ...presentBook(book, failures, meta), ...pager };
  }, [
    configured,
    lendings.length,
    pager,
    query.data,
    query.dataUpdatedAt,
    query.error,
    query.hasNextPage,
    query.isError,
    query.isFetching,
    query.isLoading,
  ]);
}
