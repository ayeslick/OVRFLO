"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlock } from "wagmi";
import { rpcUrls } from "@/lib/config";
import { readQuery } from "@/lib/query-keys";
import {
  pinModeForRpcUrls,
  type BlockPin,
  type PinMode,
} from "@/lib/protocol/pin";

export type EnumerationPin = {
  pin: BlockPin | null;
  mode: PinMode;
  blockTimestamp: bigint | null;
  headUpdatedAt: number;
  restartEpoch: number;
  stale: boolean;
  markStaleAndRestart: () => void;
};

const pinMode = pinModeForRpcUrls(rpcUrls);

/**
 * Snapshot clock. Reuses the `useBlock` poll `useChainSkew` already runs.
 * A missing pin is not a zero count — callers fold pin readiness into configured.
 */
export function useEnumerationPin(): EnumerationPin {
  const [restartEpoch, setRestartEpoch] = useState(0);
  const [stale, setStale] = useState(false);
  const block = useBlock({
    query: {
      ...readQuery,
      enabled: typeof window !== "undefined",
    },
  });

  const pin = useMemo<BlockPin | null>(() => {
    if (block.data?.hash == null) return null;
    return { blockNumber: block.data.number, blockHash: block.data.hash };
  }, [block.data?.hash, block.data?.number]);

  const markStaleAndRestart = useCallback(() => {
    setStale(true);
    setRestartEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (!pin?.blockHash) return;
    setStale(false);
  }, [pin?.blockHash]);

  return {
    pin,
    mode: pinMode,
    blockTimestamp: block.data?.timestamp ?? null,
    headUpdatedAt: block.dataUpdatedAt ?? 0,
    restartEpoch,
    stale,
    markStaleAndRestart,
  };
}
