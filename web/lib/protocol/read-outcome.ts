import type { Hash } from "viem";
import {
  partialOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
  type ReadOutcomeMetadata,
} from "@/lib/read-outcome";
import type { BlockPin } from "./pin";

export {
  partialOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
};

/** Neutral stamp on a successful protocol read. Not a framework timestamp. */
export type ProtocolStamp = {
  fetchedAtMs: number;
  blockNumber: bigint;
  blockHash: Hash;
};

export type ProtocolMetadata = ReadOutcomeMetadata & ProtocolStamp;

export function protocolStamp(pin: BlockPin, fetchedAtMs = Date.now()): ProtocolStamp {
  return {
    fetchedAtMs,
    blockNumber: pin.blockNumber,
    blockHash: pin.blockHash,
  };
}

export function protocolMetadata(stamp: ProtocolStamp): ProtocolMetadata {
  return {
    fetchedAtMs: stamp.fetchedAtMs,
    blockNumber: stamp.blockNumber,
    blockHash: stamp.blockHash,
  };
}

export function protocolReady<T>(data: T, stamp: ProtocolStamp) {
  return readyOutcome(data, protocolMetadata(stamp));
}

export function protocolPartial<T>(
  data: T,
  failures: readonly ReadFailure[],
  stamp: ProtocolStamp,
) {
  return partialOutcome(data, failures, protocolMetadata(stamp));
}

export function protocolUnavailable<T>(
  failures: readonly ReadFailure[],
  stamp?: ProtocolStamp,
  data?: T,
) {
  return unavailableOutcome(failures, stamp ? protocolMetadata(stamp) : {}, data);
}
