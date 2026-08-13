import {
  parseWatchSearch,
  type WatchLens,
  type WatchSearch,
} from "./parse";

export type WatchSelection =
  | { kind: "none" }
  | { kind: "position"; id: bigint }
  | { kind: "loan"; id: bigint }
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
  if (parsed.position !== null) return { kind: "position", id: parsed.position };
  if (parsed.loan !== null) return { kind: "loan", id: parsed.loan };
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
  if (selection.kind === "position") params.set("position", selection.id.toString());
  if (selection.kind === "loan") params.set("loan", selection.id.toString());
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
