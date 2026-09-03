import type { Address } from "viem";
import type { PortfolioType } from "./parse";
import type { WatchSelection, WatchUrlState } from "./watch-url";

export type PortfolioIdentity = {
  lending: Address;
  id: bigint;
};

export type WaitingRequestIdentity = {
  lending: Address;
  requestId: bigint;
  streamId: bigint;
};

export type PortfolioHydration = {
  complete: boolean;
  loans: readonly PortfolioIdentity[];
  positions: readonly PortfolioIdentity[];
  waitingRequests?: readonly WaitingRequestIdentity[];
};

export type PortfolioSurface =
  | { kind: "incomplete" }
  | { kind: "empty" }
  | { kind: "hub" }
  | { kind: "collection"; type: PortfolioType }
  | {
      kind: "detail";
      selection: Extract<WatchSelection, { kind: "loan" | "position" | "stream" }>;
    };

export type PortfolioSearchApply =
  | { action: "skip" }
  | { action: "write"; type: PortfolioType | null; selection: WatchSelection };

function sameIdentity(left: PortfolioIdentity, right: PortfolioIdentity): boolean {
  return left.id === right.id && left.lending.toLowerCase() === right.lending.toLowerCase();
}

export function ownsIdentity(
  rows: readonly PortfolioIdentity[],
  lending: Address,
  id: bigint,
): boolean {
  return rows.some((row) => sameIdentity(row, { lending, id }));
}

export function ownsWaitingStream(
  rows: readonly WaitingRequestIdentity[],
  streamId: bigint,
): boolean {
  return rows.some((row) => row.streamId === streamId);
}

export function matrixFromCounts(
  loans: readonly PortfolioIdentity[],
  positions: readonly PortfolioIdentity[],
  waitingRequests: readonly WaitingRequestIdentity[] = [],
): Exclude<PortfolioSurface, { kind: "incomplete" }> {
  const loanType = loans.length + waitingRequests.length;
  const positionCount = positions.length;
  if (loanType === 0 && positionCount === 0) return { kind: "empty" };
  if (loanType === 1 && positionCount === 0) {
    const loan = loans[0];
    if (loan) return { kind: "detail", selection: { kind: "loan", lending: loan.lending, id: loan.id } };
    const request = waitingRequests[0];
    if (!request) return { kind: "empty" };
    return { kind: "detail", selection: { kind: "stream", id: request.streamId } };
  }
  if (positionCount === 1 && loanType === 0) {
    const position = positions[0];
    if (!position) return { kind: "empty" };
    return {
      kind: "detail",
      selection: { kind: "position", lending: position.lending, id: position.id },
    };
  }
  if (loanType > 1 && positionCount === 0) return { kind: "collection", type: "loan" };
  if (positionCount > 1 && loanType === 0) return { kind: "collection", type: "fixed" };
  return { kind: "hub" };
}

function ownedSelection(
  hydration: PortfolioHydration,
  selection: WatchSelection,
): Extract<WatchSelection, { kind: "loan" | "position" | "stream" }> | null {
  if (selection.kind === "loan" && ownsIdentity(hydration.loans, selection.lending, selection.id)) {
    return selection;
  }
  if (
    selection.kind === "position" &&
    ownsIdentity(hydration.positions, selection.lending, selection.id)
  ) {
    return selection;
  }
  if (
    selection.kind === "stream" &&
    ownsWaitingStream(hydration.waitingRequests ?? [], selection.id)
  ) {
    return selection;
  }
  return null;
}

function collectionFromType(
  hydration: PortfolioHydration,
  type: PortfolioType | null,
): PortfolioType | null {
  const waiting = hydration.waitingRequests ?? [];
  const loanType = hydration.loans.length + waiting.length;
  if (type === "loan" && loanType > 0) {
    if (loanType === 1 && hydration.positions.length === 0) return null;
    return "loan";
  }
  if (type === "fixed" && hydration.positions.length > 0) {
    if (hydration.positions.length === 1 && loanType === 0) return null;
    return "fixed";
  }
  return null;
}

export function classifyPortfolio(
  hydration: PortfolioHydration,
  url: Pick<WatchUrlState, "type" | "selection">,
): PortfolioSurface {
  if (!hydration.complete) return { kind: "incomplete" };
  const waiting = hydration.waitingRequests ?? [];
  if (url.selection.kind === "stream") {
    if (ownsWaitingStream(waiting, url.selection.id)) {
      return { kind: "detail", selection: url.selection };
    }
    return matrixFromCounts(hydration.loans, hydration.positions, waiting);
  }
  const owned = ownedSelection(hydration, url.selection);
  if (owned) return { kind: "detail", selection: owned };
  const collectionType = collectionFromType(hydration, url.type);
  if (collectionType) return { kind: "collection", type: collectionType };
  return matrixFromCounts(hydration.loans, hydration.positions, waiting);
}

export function applyPortfolioSearch(
  hydration: PortfolioHydration,
  url: Pick<WatchUrlState, "type" | "selection">,
): PortfolioSearchApply {
  if (!hydration.complete) return { action: "skip" };
  if (url.selection.kind === "stream") {
    return { action: "write", type: null, selection: url.selection };
  }
  const surface = classifyPortfolio(hydration, url);
  if (surface.kind === "incomplete") return { action: "skip" };
  if (surface.kind === "empty" || surface.kind === "hub") {
    return { action: "write", type: null, selection: { kind: "none" } };
  }
  if (surface.kind === "collection") {
    return { action: "write", type: surface.type, selection: { kind: "none" } };
  }
  return { action: "write", type: null, selection: surface.selection };
}
