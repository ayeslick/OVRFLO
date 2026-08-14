import type { Address } from "viem";
import type { BlockIdentity } from "./discovery/types";
import { parseFlowDraft, parseJsonStorage, serializeFlowDraft, stringifyWithBigint, type FlowDraft } from "./parse";

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

function isBlockIdentity(value: unknown): value is BlockIdentity {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { number?: unknown; hash?: unknown };
  return typeof record.number === "bigint" && typeof record.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(record.hash);
}

export function readCheckpoint(key: string): BlockIdentity | null {
  return parseJsonStorage(storageGet(key), isBlockIdentity);
}

/**
 * Persist a scan checkpoint, keeping the higher block so a stale tab cannot
 * regress a fresher tab (B8).
 */
export function writeCheckpointMax(key: string, next: BlockIdentity): BlockIdentity {
  const existing = readCheckpoint(key);
  const chosen =
    existing && existing.number > next.number
      ? existing
      : existing && existing.number === next.number
        ? existing
        : next;
  storageSet(key, stringifyWithBigint(chosen));
  return chosen;
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

export function scanCheckpointKey(chainId: number, account: string): string {
  return `ovrflo:scan-checkpoint:${chainId}:${account.toLowerCase()}`;
}

export function streamCandidatesKey(chainId: number, account: string): string {
  return `ovrflo:stream-candidates:${chainId}:${account.toLowerCase()}`;
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

function isDecimalIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && /^(0|[1-9][0-9]*)$/.test(entry));
}

export function readCandidateIds(key: string): bigint[] {
  const parsed = parseJsonStorage(storageGet(key), isDecimalIdList);
  if (!parsed) return [];
  return parsed.map((entry) => BigInt(entry));
}

/** Union newly discovered stream IDs with the persisted set so incremental scans keep history. */
export function writeCandidateIdsUnion(key: string, incoming: readonly bigint[]): bigint[] {
  const merged = new Set<string>(readCandidateIds(key).map((id) => id.toString()));
  for (const id of incoming) {
    if (id > 0n) merged.add(id.toString());
  }
  const ordered = [...merged].sort((left, right) => {
    const delta = BigInt(left) - BigInt(right);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  });
  storageSet(key, JSON.stringify(ordered));
  return ordered.map((entry) => BigInt(entry));
}
