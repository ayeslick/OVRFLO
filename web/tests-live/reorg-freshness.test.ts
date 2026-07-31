import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { ovrfloLendingAbi } from "@/lib/abis";
import {
  createProjectionReadClient,
  discoverMarketLiquidity,
} from "@/lib/discovery/live-projection";

// U9 acceptance: "Anvil snapshot/revert or mid-chunk reorg produces no stale
// ready projection." Chunk-boundary reorg guards are unit-tested; this is the
// live half — after evm_revert, a fresh discovery must reflect the reverted
// chain, never a ready projection containing the rolled-back position.

type Deployment = {
  lending: Address;
  primaryMarket: Address;
  lendingDeploymentBlock: string;
  lenderWallet: Address;
};

const deployment: Deployment = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../deployments/local.json"), "utf8"),
);

const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const publicClient = createPublicClient({ chain: mainnet, transport: http(rpc) });
const client = createProjectionReadClient(publicClient);

// Anvil dev account #2 — the seeded lender (public dev key, local fork only).
const lender = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const walletClient = createWalletClient({ chain: mainnet, transport: http(rpc), account: lender });

const WSTETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

async function discover() {
  const outcome = await discoverMarketLiquidity({
    client,
    lending: deployment.lending,
    market: deployment.primaryMarket,
    fromBlock: BigInt(deployment.lendingDeploymentBlock),
  });
  if (outcome.status !== "ready") {
    throw new Error(outcome.failures.map((f) => f.message).join("; "));
  }
  return outcome.data;
}

describe("U9 live snapshot/revert freshness", () => {
  it("a projection discovered after evm_revert never contains the rolled-back position", async () => {
    const before = await discover();
    const beforeIds = new Set(before.positions.map((p) => p.id));

    const snapshot = (await publicClient.request({
      method: "evm_snapshot" as never,
      params: [] as never,
    })) as string;

    const aprMinBps = (await publicClient.readContract({
      address: deployment.lending,
      abi: ovrfloLendingAbi,
      functionName: "aprMinBps",
    })) as number;
    const amount = 10_000_000_000_000_000n; // 0.01 wstETH
    await walletClient.writeContract({
      address: WSTETH,
      abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
      functionName: "approve",
      args: [deployment.lending, amount],
    });
    const supplyHash = await walletClient.writeContract({
      address: deployment.lending,
      abi: ovrfloLendingAbi,
      functionName: "supplyLiquidity",
      args: [deployment.primaryMarket, aprMinBps, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: supplyHash });

    const during = await discover();
    const newIds = during.positions.filter((p) => !beforeIds.has(p.id)).map((p) => p.id);
    expect(newIds.length).toBeGreaterThan(0);

    const reverted = (await publicClient.request({
      method: "evm_revert" as never,
      params: [snapshot] as never,
    })) as boolean;
    expect(reverted).toBe(true);

    const after = await discover();
    const afterIds = new Set(after.positions.map((p) => p.id));
    for (const id of newIds) {
      expect(afterIds.has(id), `rolled-back position ${id} leaked into a ready projection`).toBe(
        false,
      );
    }
    expect(after.aggregateDepth).toBe(before.aggregateDepth);
  }, 120_000);
});
