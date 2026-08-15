import type { Address } from "viem";
import { parseFlowDraft, parseJsonStorage, serializeFlowDraft, type FlowDraft } from "./parse";

/**
 * Throw-tolerant localStorage (Safari private mode throws).
 * Degraded storage returns defaults / refuses to persist — it never throws to callers.
 */

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): boolean {
  try {
    const current = store();
    if (!current) return false;
    current.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): boolean {
  try {
    store()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function acknowledgmentKey(chainId: number, account: string): string {
  return `ovrflo:ack:${chainId}:${account.toLowerCase()}`;
}

export function usdModeKey(chainId: number, account: string): string {
  return `ovrflo:usd-mode:${chainId}:${account.toLowerCase()}`;
}

export function lensKey(chainId: number, account: string): string {
  return `ovrflo:lens:${chainId}:${account.toLowerCase()}`;
}

/** One-shot wrap-shortfall handoff so repay amount survives the Assets round-trip. */
export function repayHandoffKey(): string {
  return "ovrflo:repay-handoff";
}

/** # ponytail: throw-tolerant storage; wrap-shortfall amount is lost if setItem fails. Recover by re-entering the amount. */
export function writeRepayHandoff(loanId: bigint, amountRaw: string): void {
  storageSet(repayHandoffKey(), JSON.stringify({ loanId: loanId.toString(), amountRaw }));
}

export function readRepayHandoff(loanId: bigint): string | null {
  const parsed = parseJsonStorage(
    storageGet(repayHandoffKey()),
    (value): value is { loanId: string; amountRaw: string } =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { loanId?: unknown }).loanId === "string" &&
      typeof (value as { amountRaw?: unknown }).amountRaw === "string",
  );
  if (!parsed || parsed.loanId !== loanId.toString()) return null;
  storageRemove(repayHandoffKey());
  return parsed.amountRaw;
}

export type FlowDraftKind = "supply" | "borrow";

/**
 * Selections-only drafts, namespaced by factory so a fork session cannot
 * poison mainnet storage (sweep: deployment identity, not chainId alone).
 */
export function flowDraftKey(
  kind: FlowDraftKind,
  factory: Address | string,
  chainIdValue: number,
  account: string,
): string {
  return `ovrflo:draft:${kind}:${factory.toLowerCase()}:${chainIdValue}:${account.toLowerCase()}`;
}

export function readFlowDraft(key: string): FlowDraft | null {
  return parseFlowDraft(storageGet(key));
}

export function writeFlowDraft(key: string, draft: FlowDraft): boolean {
  return storageSet(key, serializeFlowDraft(draft));
}

export function clearFlowDraft(key: string): boolean {
  return storageRemove(key);
}
