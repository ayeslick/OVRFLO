import { decodeEventLog, encodeEventTopics, isAddressEqual, type Address, type Hex } from "viem";
import { ovrfloAbi, sablierLockupAbi } from "../abis";
import type { ValidatedLog } from "./types";

export type DepositedOrigin = {
  vault: Address;
  streamId: bigint;
};

export type RecipientTransfer = {
  streamId: bigint;
  to: Address;
};

export function depositedTopics(): readonly (Hex | readonly Hex[] | null)[] {
  return encodeEventTopics({ abi: ovrfloAbi, eventName: "Deposited" });
}

export function recipientTransferTopics(recipient: Address): readonly (Hex | readonly Hex[] | null)[] {
  return encodeEventTopics({
    abi: sablierLockupAbi,
    eventName: "Transfer",
    args: { to: recipient },
  });
}

export function decodeDepositedOrigin(log: ValidatedLog): DepositedOrigin {
  const decoded = decodeEventLog({
    abi: ovrfloAbi,
    eventName: "Deposited",
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  return { vault: log.address, streamId: decoded.args.streamId };
}

export function decodeRecipientTransfer(log: ValidatedLog): RecipientTransfer {
  const decoded = decodeEventLog({
    abi: sablierLockupAbi,
    eventName: "Transfer",
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  return { streamId: decoded.args.tokenId, to: decoded.args.to };
}

export type VaultRegistryOutcome =
  | { status: "complete"; vaults: readonly Address[] }
  | { status: "partial" | "unavailable"; vaults?: readonly Address[]; error: string };

type StreamCandidateInput = {
  vaultRegistry: VaultRegistryOutcome;
  origins: readonly DepositedOrigin[];
  recipientTransfers: readonly RecipientTransfer[];
  recipient: Address;
  candidateLimit: number;
};

export function discoverStreamCandidates(input: StreamCandidateInput) {
  if (input.vaultRegistry.status !== "complete") {
    return {
      status: "unavailable" as const,
      candidateIds: [] as bigint[],
      error: input.vaultRegistry.error,
    };
  }
  if (!Number.isSafeInteger(input.candidateLimit) || input.candidateLimit < 0) {
    throw new Error("candidateLimit must be a non-negative safe integer");
  }

  const vaults = new Set(input.vaultRegistry.vaults.map((vault) => vault.toLowerCase()));
  const originIds = new Set(
    input.origins
      .filter((origin) => origin.streamId > 0n && vaults.has(origin.vault.toLowerCase()))
      .map((origin) => origin.streamId),
  );
  let recipientCount = 0;
  const intersectedIds = new Set<bigint>();
  for (const transfer of input.recipientTransfers) {
    if (transfer.streamId <= 0n || !isAddressEqual(transfer.to, input.recipient)) continue;
    recipientCount += 1;
    if (originIds.has(transfer.streamId)) intersectedIds.add(transfer.streamId);
  }
  const intersection = [...intersectedIds].sort(compareBigint);
  const candidateIds = intersection.slice(0, input.candidateLimit);
  const base = {
    candidateIds,
    originCount: originIds.size,
    // This is an event diagnostic; candidate and intersection counts remain unique stream IDs.
    recipientCount,
    intersectionCount: intersection.length,
  };
  return intersection.length > input.candidateLimit
    ? { status: "partial" as const, ...base, error: "Stream candidate hydration limit reached" }
    : { status: "complete" as const, ...base };
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
