"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { chainId, isConfiguredAddress } from "@/lib/config";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { borrowerBookKeys, readQuery } from "@/lib/query-keys";
import { bookFields, nextPageParam } from "@/lib/stream-book";
import {
  loadFactoryBorrowerPage,
  type BorrowerLoanRow,
} from "@/lib/protocol/lending";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { BookPager } from "./useStreams";

export type { BorrowerLoanRow };

export type BorrowerBook = {
  loans: readonly BorrowerLoanRow[];
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export type BorrowerBookResult = ReadOutcome<BorrowerBook> & BookPager;

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

export function useBorrowerBook(
  lending: Address | readonly Address[] | null | undefined,
  account: Address | null | undefined,
  options?: { enabled?: boolean },
): BorrowerBookResult {
  const lendings = asLendings(lending);
  const enabledFlag = options?.enabled ?? true;
  const publicClient = usePublicClient({ chainId });
  const configured =
    enabledFlag &&
    isConfiguredAddress(account ?? null) &&
    publicClient !== undefined;

  const query = useInfiniteQuery({
    queryKey: borrowerBookKeys.factory(chainId, account, lendings),
    queryFn: async ({ pageParam, signal }) => {
      if (!publicClient || !account) throw new Error("borrower page query ran unconfigured");
      const outcome = await loadFactoryBorrowerPage(
        publicClient,
        lendings,
        account,
        pageParam,
        pageParam + STREAM_PAGE_SIZE,
        { signal },
      );
      if (outcome.status === "unavailable") {
        throw new Error(outcome.failures[0]?.message ?? "borrower page failed");
      }
      if (outcome.status !== "ready") {
        throw new Error("borrower page did not resolve");
      }
      return outcome.data;
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
    if (!configured) return { ...loadingOutcome<BorrowerBook>(undefined, meta), ...idlePager };
    if (lendings.length === 0) {
      const book: BorrowerBook = {
        loans: [],
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
      return { ...loadingOutcome<BorrowerBook>(undefined, meta), ...pager };
    }
    if (query.isError) {
      const sourceCount = query.data?.pages[0]?.sourceCount ?? 0n;
      const loans = query.data?.pages.flatMap((page) => [...page.loans]) ?? [];
      const book =
        query.data === undefined
          ? undefined
          : {
              loans,
              ...bookFields({
                sourceCount,
                renderCount: loans.length,
                complete: false,
                unresolvedFailures: true,
              }),
            };
      return {
        ...unavailableOutcome(
          [readFailure("useBorrowerBook", "transport", query.error ?? "borrower page failed")],
          meta,
          book,
        ),
        ...pager,
      };
    }
    if (!query.data) {
      return { ...loadingOutcome<BorrowerBook>(undefined, meta), ...pager };
    }
    const sourceCount = query.data.pages[0]?.sourceCount ?? 0n;
    const loans = query.data.pages.flatMap((page) => [...page.loans]);
    const complete = !query.hasNextPage && !query.isFetching;
    const book: BorrowerBook = {
      loans,
      ...bookFields({
        sourceCount,
        renderCount: loans.length,
        complete,
        unresolvedFailures: false,
      }),
    };
    if (!complete && loans.length === 0) {
      return { ...loadingOutcome(book, meta), ...pager };
    }
    return { ...readyOutcome(book, meta), ...pager };
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
