import { parseEventLogs, type Log } from "viem";
import { ovrfloLendingAbi } from "./abis";

/** Sum `Claimed.amount` for this position from a lending receipt. Null if no matching log. */
export function claimedPayoutFromLogs(
  logs: readonly Log[] | undefined,
  positionId: bigint | undefined,
): bigint | null {
  if (!logs || positionId === undefined) return null;
  const claimed = parseEventLogs({
    abi: ovrfloLendingAbi,
    logs: [...logs],
    eventName: "Claimed",
  });
  const matched = claimed.filter((entry) => entry.args.positionId === positionId);
  if (matched.length === 0) return null;
  return matched.reduce((sum, entry) => sum + BigInt(entry.args.amount ?? 0n), 0n);
}
