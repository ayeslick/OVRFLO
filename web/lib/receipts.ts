import type { Address, Hash } from "viem";
import { parseJsonStorage, stringifyWithBigint } from "./parse";
import { storageGet, storageRemove, storageSet } from "./storage";

/** Executor CONFIRMED waits for this many confirmations so a 1-block reorg cannot pin false state. */
export const RECEIPT_CONFIRMATIONS = 2;

export type ReceiptEntityKind = "position" | "loan" | "stream" | "wrap" | "unwrap";

export type RecoverableReceipt = {
  hash: Hash;
  status: "pending" | "confirmed";
  entityKind: ReceiptEntityKind;
  entityId: string | null;
  preTxBalances: Record<string, string>;
};

export type BalanceGuardVerdict = "accept-live" | "suppress-pre-tx" | "regress-pending";

function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isRecoverableReceipt(value: unknown): value is RecoverableReceipt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isHash(record.hash)) return false;
  if (record.status !== "pending" && record.status !== "confirmed") return false;
  if (
    record.entityKind !== "position" &&
    record.entityKind !== "loan" &&
    record.entityKind !== "stream" &&
    record.entityKind !== "wrap" &&
    record.entityKind !== "unwrap"
  ) {
    return false;
  }
  if (record.entityId !== null && typeof record.entityId !== "string") return false;
  if (typeof record.preTxBalances !== "object" || record.preTxBalances === null) return false;
  return Object.values(record.preTxBalances as Record<string, unknown>).every(
    (entry) => typeof entry === "string" && /^(0|[1-9][0-9]*)$/.test(entry),
  );
}

export function receiptKey(factory: Address | string, hash: Hash): string {
  return `ovrflo:receipt:${factory.toLowerCase()}:${hash.toLowerCase()}`;
}

export function readReceipt(factory: Address | string, hash: Hash): RecoverableReceipt | null {
  return parseJsonStorage(storageGet(receiptKey(factory, hash)), isRecoverableReceipt);
}

export function writeReceipt(factory: Address | string, receipt: RecoverableReceipt): boolean {
  return storageSet(receiptKey(factory, receipt.hash), stringifyWithBigint(receipt));
}

export function clearReceipt(factory: Address | string, hash: Hash): boolean {
  return storageRemove(receiptKey(factory, hash));
}

/** Drop the local receipt once chain reads already show the created entity. */
export function reconcileReceipt(
  stored: RecoverableReceipt,
  entityPresent: boolean,
): RecoverableReceipt | null {
  if (stored.status === "confirmed" && entityPresent) return null;
  return stored;
}

export function balancesMatchPreTx(
  live: Record<string, bigint>,
  preTx: Record<string, string>,
): boolean {
  for (const [token, previous] of Object.entries(preTx)) {
    if (live[token] === BigInt(previous)) return true;
  }
  return false;
}

/**
 * Receipt-confirmed + stale RPC must not resurrect pre-transaction balances.
 * The guard re-fetches getTransactionReceipt: a null receipt means the block
 * reorged out — regress to PENDING rather than pinning CONFIRMED.
 */
export async function guardConfirmedBalances(input: {
  hash: Hash;
  liveBalances: Record<string, bigint>;
  preTxBalances: Record<string, string>;
  getTransactionReceipt: (hash: Hash) => Promise<{ status: string } | null>;
}): Promise<BalanceGuardVerdict> {
  if (!balancesMatchPreTx(input.liveBalances, input.preTxBalances)) return "accept-live";
  const receipt = await input.getTransactionReceipt(input.hash);
  if (receipt === null) return "regress-pending";
  return "suppress-pre-tx";
}

export function applyBalanceGuard<T>(
  verdict: BalanceGuardVerdict,
  live: T,
  lastKnownPostTx: T,
): { balances: T; status: "pending" | "confirmed" } {
  if (verdict === "accept-live") return { balances: live, status: "confirmed" };
  if (verdict === "regress-pending") return { balances: lastKnownPostTx, status: "pending" };
  return { balances: lastKnownPostTx, status: "confirmed" };
}
