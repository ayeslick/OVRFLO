"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useBlock } from "wagmi";
import { estimateSkew } from "@/lib/payoff";
import { readQuery } from "@/lib/query-keys";

const TICK_MS = 1_000;

type ClockSnapshot = {
  localNow: bigint;
  skew: bigint;
};

let snapshot: ClockSnapshot = {
  localNow: 0n,
  skew: 0n,
};
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function readLocalNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

function emit() {
  for (const listener of listeners) listener();
}

function ensureInterval() {
  if (intervalId !== null) return;
  snapshot = { ...snapshot, localNow: readLocalNow() };
  intervalId = setInterval(() => {
    snapshot = { ...snapshot, localNow: readLocalNow() };
    emit();
  }, TICK_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureInterval();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): ClockSnapshot {
  return snapshot;
}

function getServerSnapshot(): ClockSnapshot {
  return { localNow: 0n, skew: 0n };
}

export function setClockSkew(skew: bigint) {
  if (snapshot.skew === skew) return;
  snapshot = { ...snapshot, skew };
  emit();
}

export function clockSubscriberCount() {
  return listeners.size;
}

export function clockIsArmed() {
  return intervalId !== null;
}

export function resetClockStoreForTests() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  listeners.clear();
  snapshot = { localNow: 0n, skew: 0n };
}

export function emitClockForTests(localNow: bigint, skew = snapshot.skew) {
  snapshot = { localNow, skew };
  emit();
}

export type ClockValue = {
  localNow: bigint;
  skew: bigint;
  adjustedNow: bigint;
};

/**
 * Eager 1 Hz clock. Safe in client-only trees (modals, expanded rows) that
 * never hydrate against static-export HTML. Watch surfaces that sit in the
 * initial page tree must use `useClockHydrationSafe`.
 */
export function useClock(): ClockValue {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useChainSkew();
  const adjusted = current.localNow > current.skew ? current.localNow - current.skew : 0n;
  return { localNow: current.localNow, skew: current.skew, adjustedNow: adjusted };
}

/**
 * Hydration-safe 1 Hz clock. Null until the first client effect, matching
 * static-export HTML. Use in the initial page tree (shell, wall).
 */
export function useClockHydrationSafe(): ClockValue | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useChainSkew();
  if (current.localNow === 0n) return null;
  const adjusted = current.localNow > current.skew ? current.localNow - current.skew : 0n;
  return { localNow: current.localNow, skew: current.skew, adjustedNow: adjusted };
}

function useChainSkew() {
  const previous = useRef<bigint | null>(null);
  const localNow = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).localNow;
  const block = useBlock({
    query: {
      ...readQuery,
      enabled: typeof window !== "undefined",
    },
  });

  useEffect(() => {
    const timestamp = block.data?.timestamp;
    if (timestamp === undefined || localNow === 0n) return;
    const next = estimateSkew(localNow, timestamp, previous.current);
    previous.current = next;
    setClockSkew(next);
  }, [block.data?.timestamp, localNow]);
}
