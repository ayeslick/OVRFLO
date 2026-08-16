"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBlock, usePublicClient } from "wagmi";
import { chainId, rpcUrls } from "@/lib/config";
import { readQuery } from "@/lib/query-keys";
import {
  pinModeForRpcUrls,
  sameBlockHash,
  type BlockPin,
  type PinMode,
} from "@/lib/protocol/pin";

export type EnumerationPin = {
  pin: BlockPin | null;
  mode: PinMode;
  blockTimestamp: bigint | null;
  headUpdatedAt: number;
  stale: boolean;
  advancePin: () => Promise<void>;
  markFresh: () => void;
};

const pinMode = pinModeForRpcUrls(rpcUrls);

function pinFromBlock(block: { number: bigint; hash?: `0x${string}` | null } | undefined): BlockPin | null {
  if (block?.hash == null) return null;
  return { blockNumber: block.number, blockHash: block.hash };
}

/**
 * Snapshot clock. Reuses the `useBlock` poll `useChainSkew` already runs.
 * A missing pin is not a zero count — callers fold pin readiness into configured.
 * The captured pin changes only when head identity changes or advancePin runs.
 */
export function useEnumerationPin(): EnumerationPin {
  const [captured, setCaptured] = useState<BlockPin | null>(null);
  const [stale, setStale] = useState(false);
  const lastHeadHash = useRef<string | null>(null);
  const capturedRef = useRef<BlockPin | null>(null);
  capturedRef.current = captured;
  const publicClient = usePublicClient({ chainId });
  const block = useBlock({
    query: {
      ...readQuery,
      enabled: typeof window !== "undefined",
    },
  });

  const adopt = useCallback((next: BlockPin) => {
    const prev = capturedRef.current;
    if (prev && sameBlockHash(prev.blockHash, next.blockHash)) return;
    setStale(true);
    setCaptured(next);
  }, []);

  useEffect(() => {
    const next = pinFromBlock(block.data);
    if (!next) return;
    if (!capturedRef.current) {
      lastHeadHash.current = next.blockHash;
      setCaptured(next);
      return;
    }
    if (lastHeadHash.current && sameBlockHash(lastHeadHash.current, next.blockHash)) return;
    lastHeadHash.current = next.blockHash;
    adopt(next);
  }, [adopt, block.data]);

  const advancePin = useCallback(async () => {
    if (!publicClient) return;
    const latest = await publicClient.getBlock({ blockTag: "latest" });
    const next = pinFromBlock(latest);
    if (!next) return;
    lastHeadHash.current = next.blockHash;
    adopt(next);
  }, [adopt, publicClient]);

  const markFresh = useCallback(() => {
    setStale(false);
  }, []);

  return {
    pin: captured,
    mode: pinMode,
    blockTimestamp: block.data?.timestamp ?? null,
    headUpdatedAt: block.dataUpdatedAt ?? 0,
    stale,
    advancePin,
    markFresh,
  };
}
