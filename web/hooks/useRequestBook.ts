"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { chainId, isConfiguredAddress } from "@/lib/config";
import { requestBookKeys, readQuery } from "@/lib/query-keys";
import {
  loadFactoryRequestBook,
  type RestingRequestRow,
} from "@/lib/protocol/request-book";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";

export type { RestingRequestRow };

export type RequestBook = {
  requests: readonly RestingRequestRow[];
  complete: boolean;
  incomplete: boolean;
};

export type RequestBookResult = ReadOutcome<RequestBook>;

function asLendings(lending: Address | readonly Address[] | null | undefined): Address[] {
  if (!lending) return [];
  if (typeof lending === "string") return [lending];
  return [...lending];
}

export function useRequestBook(
  lending: Address | readonly Address[] | null | undefined,
  account: Address | null | undefined,
  options?: { enabled?: boolean },
): RequestBookResult {
  const lendings = asLendings(lending);
  const enabledFlag = options?.enabled ?? true;
  const publicClient = usePublicClient({ chainId });
  const configured =
    enabledFlag &&
    isConfiguredAddress(account ?? null) &&
    publicClient !== undefined;

  const query = useQuery({
    queryKey: requestBookKeys.factory(chainId, account, lendings),
    queryFn: async ({ signal }) => {
      if (!publicClient || !account) throw new Error("request book query ran unconfigured");
      const outcome = await loadFactoryRequestBook(publicClient, lendings, account, { signal });
      if (outcome.status === "unavailable") {
        throw new Error(outcome.failures[0]?.message ?? "request book failed");
      }
      if (outcome.status !== "ready" && outcome.status !== "partial") {
        throw new Error("request book did not resolve");
      }
      return {
        requests: outcome.data.requests,
        incomplete: outcome.data.incomplete,
      };
    },
    enabled: configured && lendings.length > 0,
    ...readQuery,
  });

  return useMemo(() => {
    const meta = query.dataUpdatedAt > 0 ? { dataUpdatedAt: query.dataUpdatedAt } : {};
    if (!configured) return loadingOutcome<RequestBook>(undefined, meta);
    if (lendings.length === 0) {
      return readyOutcome({ requests: [], complete: true, incomplete: false }, meta);
    }
    if (query.isLoading && !query.data) return loadingOutcome<RequestBook>(undefined, meta);
    if (query.isError) {
      return unavailableOutcome(
        [readFailure("useRequestBook", "transport", query.error ?? "request book failed")],
        meta,
        query.data
          ? { requests: query.data.requests, complete: false, incomplete: true }
          : undefined,
      );
    }
    if (!query.data) return loadingOutcome<RequestBook>(undefined, meta);
    return readyOutcome(
      {
        requests: query.data.requests,
        complete: !query.data.incomplete && !query.isFetching,
        incomplete: query.data.incomplete,
      },
      meta,
    );
  }, [
    configured,
    lendings.length,
    query.data,
    query.dataUpdatedAt,
    query.error,
    query.isError,
    query.isFetching,
    query.isLoading,
  ]);
}
