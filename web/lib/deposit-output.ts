import { decodeEventLog, type Hash } from "viem";
import { ovrfloAbi } from "./abis";

export type DepositOutput =
  | { status: "ready"; streamId: bigint }
  | { status: "blocked"; reason: "missing" | "ambiguous" };

type LogLike = {
  data?: `0x${string}` | Hash;
  topics?: readonly `0x${string}`[];
};

/**
 * A unique Deposited.streamId continues the graph.
 * Missing or ambiguous event output blocks the borrow continuation.
 */
export function decodeDepositedStreamId(logs: readonly LogLike[] | undefined): DepositOutput {
  if (!logs || logs.length === 0) return { status: "blocked", reason: "missing" };
  const ids: bigint[] = [];
  for (const log of logs) {
    if (!log.data || !log.topics || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: ovrfloAbi,
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "Deposited" && "streamId" in decoded.args) {
        const id = decoded.args.streamId;
        if (typeof id === "bigint") ids.push(id);
      }
    } catch {
      continue;
    }
  }
  if (ids.length === 0) return { status: "blocked", reason: "missing" };
  const unique = new Set(ids.map((id) => id.toString()));
  if (unique.size !== 1) return { status: "blocked", reason: "ambiguous" };
  return { status: "ready", streamId: ids[0]! };
}
