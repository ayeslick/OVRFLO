import { describe, expect, it } from "vitest";
import contract from "@/fixtures/discovery/performance-contract-v1.json";

describe("pre-U3 performance contract", () => {
  it("freezes the four R50 ceilings", () => {
    expect(Object.values(contract.tasks).map((task) => task.ceilingMs)).toEqual([
      2000,
      5000,
      5000,
      15000,
    ]);
    expect(contract.lockedBeforeUnit).toBe("U3");
  });

  it("freezes the constrained client and R49 stop threshold", () => {
    expect(contract.clients.constrainedMobileClass.cpuThrottleRate).toBe(4);
    expect(contract.clients.constrainedMobileClass.memoryMiB).toBe(2048);
    expect(contract.validHistoryChurn.gasPriceGwei).toBe(10);
    expect(contract.validHistoryChurn.minimumAttackCostEth).toBe(10);
    expect(contract.validHistoryChurn.minimumAttackGas).toBe("1000000000");
    expect(contract.validHistoryChurn.stopDecision).toMatch(/stop scanner implementation/i);
  });
});
