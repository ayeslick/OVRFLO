import type { Address, Hash } from "viem";
import type { ActionGraph, EconomicIdentity, GraphSemanticId } from "./action-graph";
import { parseJsonStorage, stringifyWithBigint } from "./parse";
import { storageGet, storageSet } from "./storage";

export type StepEvidenceStatus = "pending" | "mined" | "confirmed" | "failed" | "unknown";

export type StepEvidence = {
  factory: string;
  chainId: number;
  account: string;
  graphId: string;
  stepId: GraphSemanticId;
  status: StepEvidenceStatus;
  hash: Hash | null;
  receiptStatus: "success" | "reverted" | null;
  confirmations: number;
  decoded: Readonly<Record<string, string>> | null;
  economicIdentity: EconomicIdentity;
  graphComplete: boolean;
};

export type StepEvidenceKey = {
  factory: Address | string;
  chainId: number;
  account: Address | string;
  graphId: string;
  stepId: GraphSemanticId;
};

export type CurrentAttempt = {
  graphId: string;
  kind: string;
  accepted: boolean;
  graph?: ActionGraph;
};

function normFactory(factory: Address | string): string {
  return factory.toLowerCase();
}

function normAccount(account: Address | string): string {
  return account.toLowerCase();
}

export function stepEvidenceKey(key: StepEvidenceKey): string {
  return `ovrflo:step:${normFactory(key.factory)}:${key.chainId}:${normAccount(key.account)}:${key.graphId}:${key.stepId}`;
}

export function attemptKey(
  factory: Address | string,
  chainId: number,
  account: Address | string,
  kind: string,
): string {
  return `ovrflo:attempt:${normFactory(factory)}:${chainId}:${normAccount(account)}:${kind}`;
}

export function evidenceIndexKey(
  factory: Address | string,
  chainId: number,
  account: Address | string,
): string {
  return `ovrflo:step-index:${normFactory(factory)}:${chainId}:${normAccount(account)}`;
}

function isStepEvidence(value: unknown): value is StepEvidence {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.factory !== "string") return false;
  if (typeof row.chainId !== "number") return false;
  if (typeof row.account !== "string") return false;
  if (typeof row.graphId !== "string") return false;
  if (typeof row.stepId !== "string") return false;
  if (
    row.status !== "pending" &&
    row.status !== "mined" &&
    row.status !== "confirmed" &&
    row.status !== "failed" &&
    row.status !== "unknown"
  ) {
    return false;
  }
  if (row.hash !== null && typeof row.hash !== "string") return false;
  if (row.receiptStatus !== null && row.receiptStatus !== "success" && row.receiptStatus !== "reverted") {
    return false;
  }
  if (typeof row.confirmations !== "number") return false;
  if (typeof row.graphComplete !== "boolean") return false;
  if (typeof row.economicIdentity !== "object" || row.economicIdentity === null) return false;
  return true;
}

function isCurrentAttempt(value: unknown): value is CurrentAttempt {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.graphId !== "string" || typeof row.kind !== "string" || typeof row.accepted !== "boolean") {
    return false;
  }
  if (row.graph !== undefined && (typeof row.graph !== "object" || row.graph === null)) {
    return false;
  }
  return true;
}

function isIndex(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function rememberIndex(key: StepEvidenceKey): void {
  const index = evidenceIndexKey(key.factory, key.chainId, key.account);
  const stored = parseJsonStorage(storageGet(index), isIndex) ?? [];
  const evidenceKey = stepEvidenceKey(key);
  if (stored.includes(evidenceKey)) return;
  storageSet(index, stringifyWithBigint([...stored, evidenceKey]));
}

export function writeStepEvidence(evidence: StepEvidence): boolean {
  const key: StepEvidenceKey = {
    factory: evidence.factory,
    chainId: evidence.chainId,
    account: evidence.account,
    graphId: evidence.graphId,
    stepId: evidence.stepId,
  };
  const wrote = storageSet(stepEvidenceKey(key), stringifyWithBigint(evidence));
  if (wrote) rememberIndex(key);
  return wrote;
}

export function readStepEvidence(key: StepEvidenceKey): StepEvidence | null {
  return parseJsonStorage(storageGet(stepEvidenceKey(key)), isStepEvidence);
}

export function listStepEvidence(
  factory: Address | string,
  chainId: number,
  account: Address | string,
): StepEvidence[] {
  const stored = parseJsonStorage(storageGet(evidenceIndexKey(factory, chainId, account)), isIndex) ?? [];
  const rows: StepEvidence[] = [];
  for (const key of stored) {
    const row = parseJsonStorage(storageGet(key), isStepEvidence);
    if (row) rows.push(row);
  }
  return rows;
}

export function writeCurrentAttempt(
  factory: Address | string,
  chainId: number,
  account: Address | string,
  attempt: CurrentAttempt,
): boolean {
  return storageSet(attemptKey(factory, chainId, account, attempt.kind), stringifyWithBigint(attempt));
}

export function readCurrentAttempt(
  factory: Address | string,
  chainId: number,
  account: Address | string,
  kind: string,
): CurrentAttempt | null {
  return parseJsonStorage(storageGet(attemptKey(factory, chainId, account, kind)), isCurrentAttempt);
}

export type PersistPendingContext = {
  key: StepEvidenceKey;
  identity: EconomicIdentity;
};

export function persistPendingHash(
  key: StepEvidenceKey,
  hash: Hash,
  economicIdentity: EconomicIdentity,
): boolean {
  const previous = readStepEvidence(key);
  return writeStepEvidence({
    factory: normFactory(key.factory),
    chainId: key.chainId,
    account: normAccount(key.account),
    graphId: key.graphId,
    stepId: key.stepId,
    status: "unknown",
    hash,
    receiptStatus: null,
    confirmations: 0,
    decoded: previous?.decoded ?? null,
    economicIdentity,
    graphComplete: false,
  });
}

export function readPendingHash(key: StepEvidenceKey): Hash | null {
  return readStepEvidence(key)?.hash ?? null;
}

export function anyPersistedHash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith("ovrflo:step:")) continue;
      const row = parseJsonStorage(window.localStorage.getItem(key), isStepEvidence);
      if (row?.hash) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function anyUnresolvedHash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith("ovrflo:step:")) continue;
      const row = parseJsonStorage(window.localStorage.getItem(key), isStepEvidence);
      if (row?.hash && (row.status === "unknown" || row.status === "pending" || row.status === "mined")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
