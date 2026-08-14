import { describe, expect, it } from "vitest";
import { claimedPayoutFromLogs } from "@/lib/claim-receipt";
import { claimedLog } from "./claimed-log";

describe("claimedPayoutFromLogs", () => {
  it("sums Claimed.amount for the position and ignores other positions", () => {
    const logs = [
      claimedLog(26n, 12n * 10n ** 16n, 0),
      claimedLog(26n, 8n * 10n ** 16n, 1),
      claimedLog(99n, 50n * 10n ** 16n, 2),
    ];
    expect(claimedPayoutFromLogs(logs, 26n)).toBe(20n * 10n ** 16n);
  });

  it("returns null when logs are missing or the position is absent", () => {
    expect(claimedPayoutFromLogs(undefined, 26n)).toBeNull();
    expect(claimedPayoutFromLogs([], 26n)).toBeNull();
    expect(claimedPayoutFromLogs([claimedLog(99n, 1n)], 26n)).toBeNull();
    expect(claimedPayoutFromLogs([claimedLog(26n, 1n)], undefined)).toBeNull();
  });
});
