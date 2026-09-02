"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { classifyRpcFailure } from "@/lib/rpc";
import { useProtocolBootstrap } from "./useProtocolBootstrap";
import { useEnumerationPin } from "./useEnumerationPin";
import {
  hydrateStreamView,
  type StreamBook,
  type StreamMarket,
  type HydratedStream,
} from "./useStreams";
import { chainId, isConfiguredAddress, rpcUrl, ZERO_ADDRESS } from "@/lib/config";
import { pinnedQuery, QUERY_RETRY, streamBookKeys } from "@/lib/query-keys";
import { bookFields, presentBook, unreadBookFailure } from "@/lib/stream-book";
import { loadCompleteStreams } from "@/lib/protocol/streams";
import { verifyPinHash } from "@/lib/protocol/pin";
import {
    loadingOutcome,
    readFailure,
    unavailableOutcome,
    type ReadOutcome,
} from "@/lib/read-outcome";
import type { VaultInfo } from "@/lib/types";

/**
 * Complete held-stream set at the enumeration pin. BorrowFlow eligibility and
 * claim-all must use this, never the wall pager.
 */
export function useCompleteStreams(input: {
  account: Address | null | undefined;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
  registryComplete: boolean;
  now: bigint;
  stream?: Address;
}): ReadOutcome<StreamBook> {
  const bootstrap = useProtocolBootstrap();
  const pinState = useEnumerationPin();
  const publicClient = usePublicClient({ chainId });
  const discovered =
    input.stream ?? (bootstrap.status === "ready" ? bootstrap.stream : undefined);
  const pin = pinState.pin;
  const configured =
    isConfiguredAddress(input.account ?? null) &&
    isConfiguredAddress(discovered ?? null) &&
    input.registryComplete &&
    pin !== null &&
    publicClient !== undefined;

  const query = useQuery({
    queryKey: streamBookKeys.complete(
      chainId,
      discovered ?? ZERO_ADDRESS,
      input.account ?? ZERO_ADDRESS,
      pin?.blockHash ?? null,
    ),
    queryFn: async ({ signal }) => {
      if (!publicClient || !discovered || !input.account || !pin) {
        throw new Error("complete stream query ran without a pin");
      }
      const outcome = await loadCompleteStreams(
        publicClient,
        discovered,
        input.account,
        pin,
        { signal, pinMode: pinState.mode, providerKey: rpcUrl },
      );
      if (outcome.status === "unavailable") {
        for (const failure of outcome.failures) {
          if (classifyRpcFailure(failure.message) === "unknown_block") {
            throw new Error(failure.message);
          }
        }
      }
      if (pinState.mode === "number" && outcome.status !== "unavailable") {
        const verified = await verifyPinHash(publicClient, pin);
        if (!verified.ok) {
          throw new Error(verified.message);
        }
      }
      return outcome;
    },
    enabled: configured,
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

  const pageStamp = useRef<{
    blockNumber: bigint;
    blockHash: `0x${string}`;
    blockTimestamp: bigint | null;
  } | null>(null);
  if (pin && query.data && !query.isPlaceholderData) {
    pageStamp.current = {
      blockNumber: pin.blockNumber,
      blockHash: pin.blockHash,
      blockTimestamp: pinState.blockTimestamp,
    };
  }
  const stamp = query.isPlaceholderData ? pageStamp.current : pin
    ? {
        blockNumber: pin.blockNumber,
        blockHash: pin.blockHash,
        blockTimestamp: pinState.blockTimestamp,
      }
    : null;
  const meta = {
    dataUpdatedAt: pinState.headUpdatedAt || query.dataUpdatedAt,
    blockNumber: stamp?.blockNumber,
    blockHash: stamp?.blockHash,
    blockTimestamp: stamp?.blockTimestamp ?? undefined,
  };

  return useMemo(() => {
    if (bootstrap.status === "unavailable" && input.stream === undefined) {
      return unavailableOutcome(
        bootstrap.failures.map((failure) =>
          readFailure("useCompleteStreams", "transport", failure.message),
        ),
        meta,
      );
    }
    if (!configured) return loadingOutcome<StreamBook>(undefined, meta);
    if (query.isLoading && query.data === undefined) {
      return loadingOutcome<StreamBook>(undefined, meta);
    }
    if (query.isError || !query.data) {
      return unavailableOutcome(
        [readFailure("useCompleteStreams", "transport", query.error ?? "complete streams failed")],
        meta,
      );
    }
    const outcome = query.data;
    if (outcome.status === "unavailable") {
      return unavailableOutcome(outcome.failures, meta, emptyBook(0n));
    }
    if (outcome.status !== "ready" && outcome.status !== "partial") {
      return loadingOutcome<StreamBook>(undefined, meta);
    }
    const streams: HydratedStream[] = [];
    let okFalse = false;
    for (const view of outcome.data.streams) {
      if (!view.ok) okFalse = true;
      const hydrated = hydrateStreamView(view, input);
      if (hydrated) streams.push(hydrated);
    }
    const sourceCount = BigInt(outcome.data.streams.length);
    const unresolved = outcome.status === "partial" || okFalse || outcome.failures.length > 0;
    const fields = bookFields({
      sourceCount,
      renderCount: streams.length,
      complete: !unresolved,
      unresolvedFailures: unresolved,
    });
    const book: StreamBook = { streams, ...fields };
    if (unresolved && streams.length === 0) {
      return unavailableOutcome(
        outcome.failures.length > 0
          ? outcome.failures
          : [readFailure("useCompleteStreams", "subcall", "complete set had failed rows")],
        meta,
        book,
      );
    }
    const freshness = query.isPlaceholderData || pinState.stale ? "stale" : "fresh";
    const failures =
      outcome.failures.length > 0
        ? outcome.failures
        : unresolved
          ? [unreadBookFailure("useCompleteStreams")]
          : [];
    return presentBook(book, failures, { ...meta, ...outcome.metadata }, freshness);
  }, [
    bootstrap,
    configured,
    input,
    meta,
    pinState.stale,
    query.data,
    query.error,
    query.isError,
    query.isLoading,
    query.isPlaceholderData,
  ]);
}

function emptyBook(sourceCount: bigint): StreamBook {
  return {
    streams: [],
    sourceCount,
    renderCount: 0,
    complete: true,
    confirmedEmpty: sourceCount === 0n,
  };
}
