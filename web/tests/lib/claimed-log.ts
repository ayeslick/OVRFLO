import { encodeAbiParameters, encodeEventTopics, type Hex, type Log } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";

const LENDING = "0x4444444444444444444444444444444444444444" as const;

export function claimedLog(positionId: bigint, amount: bigint, logIndex = 0): Log {
  const topics = encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "Claimed",
    args: { loanId: 1n, positionId },
  });
  const data = encodeAbiParameters(
    [{ type: "uint128" }, { type: "uint128" }],
    [amount, amount],
  );
  return {
    address: LENDING,
    blockHash: `0x${"00".repeat(32)}`,
    blockNumber: 1n,
    logIndex,
    transactionHash: `0x${"11".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
    data: data as Hex,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
  };
}
