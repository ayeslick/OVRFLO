"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { WatchLens } from "@/lib/parse";
import {
  getWatchSearchServerSnapshot,
  getWatchSearchSnapshot,
  parseWatchUrl,
  subscribeWatchUrl,
  writeWatchSearch,
  type WatchSelection,
  type WatchUrlState,
} from "@/lib/watch-url";

export function useWatchUrl(): WatchUrlState & {
  setLens: (lens: WatchLens) => void;
  select: (selection: WatchSelection) => void;
  deselect: () => void;
  goHome: () => void;
} {
  const search = useSyncExternalStore(
    subscribeWatchUrl,
    getWatchSearchSnapshot,
    getWatchSearchServerSnapshot,
  );
  const parsed = parseWatchUrl(search);

  const setLens = useCallback((lens: WatchLens) => {
    writeWatchSearch({ lens, selection: { kind: "none" } }, "push");
  }, []);

  const select = useCallback((selection: WatchSelection) => {
    const current = parseWatchUrl(getWatchSearchSnapshot());
    writeWatchSearch({ lens: current.lens, selection }, "push");
  }, []);

  const deselect = useCallback(() => {
    const current = parseWatchUrl(getWatchSearchSnapshot());
    writeWatchSearch({ lens: current.lens, selection: { kind: "none" } }, "push");
  }, []);

  const goHome = useCallback(() => {
    const current = parseWatchUrl(getWatchSearchSnapshot());
    writeWatchSearch({ lens: current.lens, selection: { kind: "none" } }, "push");
  }, []);

  return { ...parsed, setLens, select, deselect, goHome };
}
