import type { Address, Hex, Log } from "viem";

export type BlockIdentity = {
  number: bigint;
  hash: Hex;
};

export type HeadSnapshot = {
  finalized: BlockIdentity;
  latest: BlockIdentity;
};

export type CompleteThrough = BlockIdentity;

export type DiscoveryScope = {
  chainId: number;
  factoryAnchor: BlockIdentity;
  address: Address | readonly Address[];
  topics: readonly (Hex | readonly Hex[] | null)[];
  schemaVersion: number;
};

export type ValidatedLog = Log & {
  address: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  topics: readonly Hex[];
};

export type RpcAttemptOutcome =
  | "success"
  | "rate-limited"
  | "capacity"
  | "timeout"
  | "range-too-large"
  | "transport-error"
  | "cancelled";

export type RpcAttempt = {
  attempt: number;
  fromBlock: bigint;
  toBlock: bigint;
  outcome: RpcAttemptOutcome;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  providerCostEstimate: number;
};

export type RpcLedger = {
  attempts: RpcAttempt[];
  requestBytes: number;
  responseBytes: number;
  reducerDurationMs: number;
  durationMs: number;
  providerCostEstimate: number;
};
