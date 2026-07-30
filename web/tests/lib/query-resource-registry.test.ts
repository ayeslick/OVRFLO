import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  buildRefreshPlan,
  refreshQueryResources,
} from "@/lib/query-resource-registry";
import { projectionKeys } from "@/lib/query-keys";
import { readyOutcome } from "@/lib/read-outcome";

const account = "0x00000000000000000000000000000000000000a1" as Address;
const lending = "0x00000000000000000000000000000000000000b2" as Address;
const market = "0x00000000000000000000000000000000000000c3" as Address;
const other = "0x00000000000000000000000000000000000000d4" as Address;
const anchor = { number: 1n, hash: `0x${"11".repeat(32)}` as const };
const head = { number: 25n, hash: `0x${"22".repeat(32)}` as const };

describe("query resource registry", () => {
  it("maps touched event scopes and direct resources without widening to unrelated markets", () => {
    const plan = buildRefreshPlan(
      [
        { kind: "market-depth", lending, market, aprBps: 1_000 },
        { kind: "token-balance", token: market, account },
      ],
      { account, chainId: 1 },
    );

    expect(plan.matches([
      "readContract",
      { address: market, functionName: "balanceOf", args: [account] },
    ])).toBe(true);
    expect(plan.matches([
      "readContract",
      { address: other, functionName: "balanceOf", args: [account] },
    ])).toBe(false);
    expect(plan.matches(projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending,
      kind: "market-apr",
      market,
      aprBps: 1_000,
    }))).toBe(true);
    expect(plan.matches(projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending: other,
      kind: "market-apr",
      market: other,
      aprBps: 1_000,
    }))).toBe(false);
  });

  it("maps a loan to lender, borrower, demand, stream, and lending hydration scopes", () => {
    const plan = buildRefreshPlan(
      [{ kind: "loan", lending, id: 7n }],
      { account, chainId: 1 },
    );

    for (const kind of ["lender", "borrower", "demand"] as const) {
      expect(plan.matches(projectionKeys.scope({
        chainId: 1,
        factoryAnchor: anchor,
        lending,
        kind,
      }))).toBe(true);
    }
    expect(plan.matches(projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      kind: "stream",
      account,
    }))).toBe(true);
    expect(plan.matches([
      "readContract",
      { address: lending, functionName: "loans", args: [7n] },
    ])).toBe(true);
    expect(plan.matches(projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending: other,
      kind: "borrower",
    }))).toBe(false);
  });

  it("maps a stream to stream projection and Sablier hydration only", () => {
    const plan = buildRefreshPlan(
      [{ kind: "stream", sablier: lending, id: 9n }],
      { account, chainId: 1 },
    );

    expect(plan.matches(projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      kind: "stream",
      account,
    }))).toBe(true);
    expect(plan.matches([
      "readContract",
      { address: lending, functionName: "withdrawableAmountOf", args: [9n] },
    ])).toBe(true);
    expect(plan.matches([
      "readContract",
      { address: other, functionName: "withdrawableAmountOf", args: [9n] },
    ])).toBe(false);
  });

  it("captures one discovery head and rejects stale/partial projection refreshes", async () => {
    const client = new QueryClient();
    const key = projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending,
      kind: "market-apr",
      market,
      aprBps: 1_000,
    });
    client.setQueryDefaults(key, {
      queryFn: async () => readyOutcome(
        { ids: [1n] },
        { blockNumber: 24n, blockHash: anchor.hash },
        "stale",
      ),
    });
    await client.fetchQuery({ queryKey: key });
    const captureHead = vi.fn().mockResolvedValue(head);
    const plan = buildRefreshPlan(
      [{ kind: "market-depth", lending, market, aprBps: 1_000 }],
      { account, chainId: 1 },
    );

    const hydrate = vi.fn().mockResolvedValue(undefined);
    await expect(refreshQueryResources(client, plan, { captureHead, hydrate })).rejects.toThrow(
      /fresh and ready/i,
    );
    expect(captureHead).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("reconciles active projection scopes through the captured post-receipt head", async () => {
    const client = new QueryClient();
    const key = projectionKeys.scope({
      chainId: 1,
      factoryAnchor: anchor,
      lending,
      kind: "market-apr",
      market,
      aprBps: 1_000,
    });
    client.setQueryDefaults(key, {
      queryFn: async () => readyOutcome(
        { ids: [1n, 2n] },
        { blockNumber: head.number, blockHash: head.hash },
      ),
    });
    await client.fetchQuery({ queryKey: key });
    const captureHead = vi.fn().mockResolvedValue(head);
    const plan = buildRefreshPlan(
      [{ kind: "liquidity-position", lending, id: 2n }],
      { account, chainId: 1 },
    );

    const hydrate = vi.fn().mockResolvedValue(undefined);
    await expect(refreshQueryResources(client, plan, { captureHead, hydrate })).resolves.toEqual(head);
    expect(captureHead).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith(
      { kind: "liquidity-position", lending, id: 2n },
      head,
    );
  });

  it("hydrates direct resources when no projection consumer is active yet", async () => {
    const client = new QueryClient();
    const captureHead = vi.fn().mockResolvedValue(head);
    const hydrate = vi.fn().mockResolvedValue(undefined);
    const plan = buildRefreshPlan(
      [{ kind: "market-depth", lending, market, aprBps: 1_000 }],
      { account, chainId: 1 },
    );

    await expect(refreshQueryResources(client, plan, { captureHead, hydrate })).resolves.toEqual(head);
    expect(captureHead).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith(
      { kind: "market-depth", lending, market, aprBps: 1_000 },
      head,
    );
  });
});
