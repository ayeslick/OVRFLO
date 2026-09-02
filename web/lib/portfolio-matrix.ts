import type { Address } from "viem";
import type { PortfolioType } from "./parse";
import type { WatchSelection, WatchUrlState } from "./watch-url";

export type PortfolioIdentity = {
  lending: Address;
  id: bigint;
};

export type PortfolioHydration = {
  complete: boolean;
  loans: readonly PortfolioIdentity[];
  positions: readonly PortfolioIdentity[];
};

export type PortfolioSurface =
  | { kind: "incomplete" }
  | { kind: "empty" }
  | { kind: "hub" }
  | { kind: "collection"; type: PortfolioType }
  | {
      kind: "detail";
      selection: Extract<WatchSelection, { kind: "loan" | "position" }>;
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

export function matrixFromCounts(
  loans: readonly PortfolioIdentity[],
  positions: readonly PortfolioIdentity[],
): Exclude<PortfolioSurface, { kind: "incomplete" }> {
  const loanCount = loans.length;
  const positionCount = positions.length;
  if (loanCount === 0 && positionCount === 0) return { kind: "empty" };
  if (loanCount === 1 && positionCount === 0) {
    const loan = loans[0];
    if (!loan) return { kind: "empty" };
    return { kind: "detail", selection: { kind: "loan", lending: loan.lending, id: loan.id } };
  }
  if (positionCount === 1 && loanCount === 0) {
    const position = positions[0];
    if (!position) return { kind: "empty" };
    return {
      kind: "detail",
      selection: { kind: "position", lending: position.lending, id: position.id },
    };
  }
  if (loanCount > 1 && positionCount === 0) return { kind: "collection", type: "loan" };
  if (positionCount > 1 && loanCount === 0) return { kind: "collection", type: "fixed" };
  return { kind: "hub" };
}

function ownedSelection(
  hydration: PortfolioHydration,
  selection: WatchSelection,
): Extract<WatchSelection, { kind: "loan" | "position" }> | null {
  if (selection.kind === "loan" && ownsIdentity(hydration.loans, selection.lending, selection.id)) {
    return selection;
  }
  if (
    selection.kind === "position" &&
    ownsIdentity(hydration.positions, selection.lending, selection.id)
  ) {
    return selection;
  }
  return null;
}

function collectionFromType(
  hydration: PortfolioHydration,
  type: PortfolioType | null,
): PortfolioType | null {
  if (type === "loan" && hydration.loans.length > 0) {
    if (hydration.loans.length === 1 && hydration.positions.length === 0) return null;
    return "loan";
  }
  if (type === "fixed" && hydration.positions.length > 0) {
    if (hydration.positions.length === 1 && hydration.loans.length === 0) return null;
    return "fixed";
  }
  return null;
}

export function classifyPortfolio(
  hydration: PortfolioHydration,
  url: Pick<WatchUrlState, "type" | "selection">,
): PortfolioSurface {
  if (!hydration.complete) return { kind: "incomplete" };
  if (url.selection.kind === "stream") return matrixFromCounts(hydration.loans, hydration.positions);
  const owned = ownedSelection(hydration, url.selection);
  if (owned) return { kind: "detail", selection: owned };
  const collectionType = collectionFromType(hydration, url.type);
  if (collectionType) return { kind: "collection", type: collectionType };
  return matrixFromCounts(hydration.loans, hydration.positions);
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
