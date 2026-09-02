import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import contract from "@/fixtures/discovery/performance-contract-v1.json";
import webPackage from "../../package.json";
import { VIEM_DLC_NPM_VERSION, VIEM_DLC_RELEASE_COMMIT } from "@/lib/rpc";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

describe("CS5 public-read dependency isolation", () => {
  it("pins @morpho-org/viem-dlc to npm 0.0.16 with the reviewed release commit", () => {
    expect(webPackage.dependencies["@morpho-org/viem-dlc"]).toBe("0.0.16");
    expect(VIEM_DLC_NPM_VERSION).toBe("0.0.16");
    expect(VIEM_DLC_RELEASE_COMMIT).toBe("0df02a9a79bce8ed0a98974034d34cf5c8de7e11");
    const installed = JSON.parse(
      readFileSync(join(webRoot, "node_modules/@morpho-org/viem-dlc/package.json"), "utf8"),
    ) as { version: string };
    expect(installed.version).toBe("0.0.16");
  });

  it("keeps viem-dlc on the public-read seam and out of wallet writes and the query store", () => {
    const dlcImport = /from ["']@morpho-org\/viem-dlc(?:\/[^"']+)?["']/;
    const rpc = readFileSync(join(webRoot, "lib/rpc.ts"), "utf8");
    expect(rpc).toMatch(dlcImport);
    expect(rpc).not.toMatch(/from ["']@morpho-org\/viem-dlc\/transports\/cache["']/);
    expect(rpc).not.toMatch(/from ["']@morpho-org\/viem-dlc\/stores["']/);
    expect(rpc).not.toMatch(/from ["']@morpho-org\/viem-dlc\/actions["']/);
    expect(readFileSync(join(webRoot, "lib/query-client.ts"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "lib/wagmi.ts"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "hooks/useWriteFlow.ts"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "components/WalletRuntime.tsx"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "tests/e2e/support/WalletRuntime.tsx"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "tests/e2e/fixtures/chain.ts"), "utf8")).not.toMatch(dlcImport);
    const pinProbe = readFileSync(join(webRoot, "lib/protocol/pin-probe.ts"), "utf8");
    expect(pinProbe).toMatch(/from ["']@morpho-org\/viem-dlc\/actions["']/);
    expect(pinProbe).toMatch(/\bpolicy\(/);
    expect(readFileSync(join(webRoot, "lib/protocol/lending.ts"), "utf8")).not.toMatch(dlcImport);
    expect(readFileSync(join(webRoot, "hooks/useWriteFlow.ts"), "utf8")).toMatch(/getWalletClient/);
  });
});
