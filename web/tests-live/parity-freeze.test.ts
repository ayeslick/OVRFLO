import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http, isAddressEqual, type Address } from "viem";
import { mainnet } from "viem/chains";
import { ovrfloLendingAbi } from "@/lib/abis";
import {
  createProjectionReadClient,
  discoverMarketLiquidity,
  type MarketLiquidityProjection,
} from "@/lib/discovery/live-projection";
import { selectHydratedRoute } from "@/lib/router";
import type { ReadOutcome } from "@/lib/read-outcome";

// U9 frozen-block parity: at one pinned block, prove aggregate storage ==
// uncapped per-position storage truth == event projection against the live
// seeded local fork (which the 501-position stress fixture loads well past
// the retired 500-ID frontend cap). The route-selection check ran against
// legacy gatherLiquidity until ticket 10 removed that view (agreement was
// recorded 2026-07-31 at the U9 cutover); it now asserts the bounded-route
// contract against the final ABI.

type Deployment = {
  lending: Address;
  primaryMarket: Address;
  lendingDeploymentBlock: string;
  lenderWallet: Address;
  devWallet: Address;
};

const deployment: Deployment = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../deployments/local.json"), "utf8"),
);

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"),
});
const client = createProjectionReadClient(publicClient);

let outcome: ReadOutcome<MarketLiquidityProjection>;
let projection: MarketLiquidityProjection;
let frozenBlock: bigint;

type StoragePosition = {
  id: bigint;
  lender: Address;
  market: Address;
  aprBps: number;
  availableLiquidity: bigint;
};

const storagePositions: StoragePosition[] = [];

beforeAll(async () => {
  outcome = await discoverMarketLiquidity({
    client,
    lending: deployment.lending,
    market: deployment.primaryMarket,
    fromBlock: BigInt(deployment.lendingDeploymentBlock),
  });
  if (outcome.status !== "ready") {
    throw new Error(
      `market projection not ready: ${outcome.failures.map((f) => f.message).join("; ")}`,
    );
  }
  projection = outcome.data;
  frozenBlock = outcome.metadata.blockNumber!;

  // Uncapped storage truth at the same frozen block: enumerate every
  // liquidity position id ever minted, no 500-ID cap, no event data.
  const nextId = (await publicClient.readContract({
    address: deployment.lending,
    abi: ovrfloLendingAbi,
    functionName: "nextLiquidityId",
    blockNumber: frozenBlock,
  })) as bigint;
  const ids = Array.from({ length: Number(nextId - 1n) }, (_, i) => BigInt(i + 1));
  const chunk = 50;
  for (let start = 0; start < ids.length; start += chunk) {
    const slice = ids.slice(start, start + chunk);
    const rows = await Promise.all(
      slice.map(
        (id) =>
          publicClient.readContract({
            address: deployment.lending,
            abi: ovrfloLendingAbi,
            functionName: "liquidityPositions",
            args: [id],
            blockNumber: frozenBlock,
          }) as Promise<readonly [Address, Address, number, bigint]>,
      ),
    );
    rows.forEach(([lender, market, aprBps, availableLiquidity], index) => {
      storagePositions.push({ id: slice[index], lender, market, aprBps, availableLiquidity });
    });
  }
}, 300_000);

const marketStorage = () =>
  storagePositions.filter(
    (position) =>
      isAddressEqual(position.market, deployment.primaryMarket) &&
      position.availableLiquidity > 0n,
  );

describe("U9 frozen-block parity (live seeded fork)", () => {
  it("uncapped storage truth exceeds the retired 500-ID cap", () => {
    expect(marketStorage().length).toBeGreaterThan(500);
  });

  it("event projection matches uncapped storage truth id-for-id", () => {
    const truth = new Map(marketStorage().map((p) => [p.id, p.availableLiquidity]));
    const projected = new Map(
      projection.positions
        .filter((p) => p.availableLiquidity > 0n)
        .map((p) => [p.id, p.availableLiquidity]),
    );
    expect(projected.size).toBe(truth.size);
    for (const [id, available] of truth) {
      expect(projected.get(id), `position ${id}`).toBe(available);
    }
  });

  it("aggregate storage equals per-position sums at every tick", async () => {
    const sums = new Map<number, bigint>();
    for (const position of marketStorage()) {
      sums.set(position.aprBps, (sums.get(position.aprBps) ?? 0n) + position.availableLiquidity);
    }
    for (const [aprBps, sum] of sums) {
      const aggregate = (await publicClient.readContract({
        address: deployment.lending,
        abi: ovrfloLendingAbi,
        functionName: "marketAprAvailableLiquidity",
        args: [deployment.primaryMarket, aprBps],
        blockNumber: frozenBlock,
      })) as bigint;
      expect(aggregate, `tick ${aprBps}`).toBe(sum);
      expect(projection.aggregateByApr.get(aprBps), `projection tick ${aprBps}`).toBe(sum);
    }
    const total = (await publicClient.readContract({
      address: deployment.lending,
      abi: ovrfloLendingAbi,
      functionName: "marketAvailableLiquidity",
      args: [deployment.primaryMarket],
      blockNumber: frozenBlock,
    })) as bigint;
    const grand = [...sums.values()].reduce((a, b) => a + b, 0n);
    expect(total).toBe(grand);
    expect(projection.aggregateDepth).toBe(grand);
  });

  it("hydrated route selection stays bounded and covered at the frozen block", async () => {
    const maxRouteIds = (await publicClient.readContract({
      address: deployment.lending,
      abi: ovrfloLendingAbi,
      functionName: "MAX_ROUTE_IDS",
      blockNumber: frozenBlock,
    })) as bigint;
    const aprBps = 1000; // stress fixture tick
    const borrower = deployment.devWallet;
    const tickPositions = projection.positions.filter(
      (p) => p.aprBps === aprBps && p.availableLiquidity > 0n,
    );
    const aggregateDepth = projection.aggregateByApr.get(aprBps) ?? 0n;
    // A target spanning several positions but within MAX_ROUTE_IDS coverage.
    const target = tickPositions
      .slice(0, Math.min(Number(maxRouteIds), 5))
      .reduce((a, p) => a + p.availableLiquidity, 0n);

    const route = selectHydratedRoute({
      positions: tickPositions,
      borrower,
      target,
      aggregateDepth,
      maxRouteIds: Number(maxRouteIds),
    });
    expect(route.status).toBe("ready");
    if (route.status !== "ready") return;

    expect(route.selectedIds.length).toBeLessThanOrEqual(Number(maxRouteIds));
    const byId = new Map(tickPositions.map((p) => [p.id, p]));
    let covered = 0n;
    let previous = -1n;
    for (const id of route.selectedIds) {
      expect(id > previous, "route ids strictly increasing").toBe(true);
      previous = id;
      const position = byId.get(id);
      expect(position, `selected id ${id} hydrated at frozen block`).toBeDefined();
      covered += position!.availableLiquidity;
    }
    expect(covered >= target, "selected route covers the target").toBe(true);
  });
});
