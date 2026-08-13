import { formatTruncatedDecimal } from "@/lib/format";
import { parseDecimalInput } from "@/lib/parse";
import { decodeEventLog } from "viem";
import { ovrfloAbi } from "@/lib/abis";

export type MoneyRead =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; value: bigint };

export function exactAmountString(value: bigint, decimals = 18): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function parseEnteredAmount(raw: string): bigint | null {
  const parsed = parseDecimalInput(raw);
  if (!parsed.ok) return null;
  return parsed.value;
}

export function moneyLabel(read: MoneyRead, symbol: string): string {
  if (read.status === "loading") return "CHECKING…";
  if (read.status === "unavailable") return "UNAVAILABLE";
  return `${formatTruncatedDecimal(read.value, 18, 5)} ${symbol}`;
}

export function asOfClock(timestamp: bigint | null): string | undefined {
  if (timestamp === null) return undefined;
  const date = new Date(Number(timestamp) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
}

export function truncateHash(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function streamIdFromLogs(logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] | undefined): bigint | null {
  if (!logs) return null;
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: ovrfloAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "Deposited" && "streamId" in decoded.args) {
        const id = decoded.args.streamId;
        if (typeof id === "bigint") return id;
      }
    } catch {
      continue;
    }
  }
  return null;
}
