"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getWatchSearchServerSnapshot,
  getWatchSearchSnapshot,
  parseWatchUrl,
  stripLensFromLocation,
  subscribeWatchUrl,
  writeWatchSearch,
  type WatchSelection,
  type WatchUrlState,
} from "@/lib/watch-url";

export function useWatchUrl(): WatchUrlState & {
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

  useEffect(() => {
    stripLensFromLocation();
  }, [search]);

  const select = useCallback((selection: WatchSelection) => {
    writeWatchSearch({ selection }, "push");
  }, []);

  const deselect = useCallback(() => {
    const current = parseWatchUrl(getWatchSearchSnapshot());
    writeWatchSearch({ type: current.type, selection: { kind: "none" } }, "push");
  }, []);

  const goHome = useCallback(() => {
    writeWatchSearch({ selection: { kind: "none" } }, "push");
  }, []);

  return { ...parsed, select, deselect, goHome };
}