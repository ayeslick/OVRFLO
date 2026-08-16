import { isAddressEqual, type Address } from "viem";
import {
  parseWatchSearch,
  type WatchLens,
  type WatchSearch,
} from "./parse";

export type WatchMarketRef = {
  lending: Address;
  id: bigint;
};

export type WatchSelection =
  | { kind: "none" }
  | { kind: "position"; lending: Address; id: bigint }
  | { kind: "loan"; lending: Address; id: bigint }
  | { kind: "stream"; id: bigint };

export type WatchUrlState = {
  lens: WatchLens | null;
  selection: WatchSelection;
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeWatchUrl(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", listener);
    }
  };
}

export function getWatchSearchSnapshot(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

export function getWatchSearchServerSnapshot(): string {
  return "";
}

export function parseWatchUrl(search: string): WatchUrlState {
  const parsed = parseWatchSearch(search);
  return {
    lens: parsed.lens,
    selection: selectionFromSearch(parsed),
  };
}

export function selectionFromSearch(parsed: WatchSearch): WatchSelection {
  if (parsed.position !== null && parsed.lending) {
    return { kind: "position", lending: parsed.lending, id: parsed.position };
  }
  if (parsed.loan !== null && parsed.lending) {
    return { kind: "loan", lending: parsed.lending, id: parsed.loan };
  }
  if (parsed.stream !== null) return { kind: "stream", id: parsed.stream };
  return { kind: "none" };
}

export function serializeWatchSearch(state: {
  lens?: WatchLens | null;
  selection?: WatchSelection;
}): string {
  const params = new URLSearchParams();
  if (state.lens) params.set("lens", state.lens);
  const selection = state.selection ?? { kind: "none" };
  if (selection.kind === "position") {
    params.set("lending", selection.lending);
    params.set("position", selection.id.toString());
  }
  if (selection.kind === "loan") {
    params.set("lending", selection.lending);
    params.set("loan", selection.id.toString());
  }
  if (selection.kind === "stream") params.set("stream", selection.id.toString());
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function writeWatchSearch(
  state: { lens?: WatchLens | null; selection?: WatchSelection },
  mode: "push" | "replace" = "push",
) {
  if (typeof window === "undefined") return;
  const search = serializeWatchSearch(state);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
  notify();
}

export function inferredLens(selection: WatchSelection): WatchLens | null {
  if (selection.kind === "position") return "supplied";
  if (selection.kind === "loan") return "borrowed";
  if (selection.kind === "stream") return "streams";
  return null;
}

export function selectionMatchesRow(
  selection: WatchSelection,
  kind: "position" | "loan",
  row: WatchMarketRef,
): boolean {
  if (selection.kind !== kind) return false;
  return selection.id === row.id && isAddressEqual(selection.lending, row.lending);
}
