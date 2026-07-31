import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  runActionExecution,
  type ActionExecutionRuntime,
} from "@/lib/action-runtime";
import type { ActionIdentity } from "@/lib/actions/types";
import {
  createClaimAllRowExecutionPlan,
} from "@/lib/claim-all-execution";
import type { QueuedTx } from "@/lib/claim-all";
import type { LiveMarketScope } from "@/lib/live-action-plan";

const account = "0x00000000000000000000000000000000000000a1" as Address;
const vault = "0x00000000000000000000000000000000000000b2" as Address;
const lending = "0x00000000000000000000000000000000000000c3" as Address;
const market = "0x00000000000000000000000000000000000000d4" as Address;
const asset = "0x00000000000000000000000000000000000000e5" as Address;
const ptToken = "0x00000000000000000000000000000000000000f6" as Address;
const hash = `0x${"12".repeat(32)}` as Hash;
const blockHash = `0x${"34".repeat(32)}` as Hash;

const identity: ActionIdentity = { account, chainId: 1 };
const scope: LiveMarketScope = {
  vault,
  lending,
  market,
  underlying: asset,
  ovrfloToken: asset,
  ptToken,
  expiryCached: 2_000n,
};
const row: QueuedTx = {
  kind: "pool-claims",
  lending,
  claims: [
    { loanId: 1n, claimable: 100n },
    { loanId: 2n, claimable: 100n },
  ],
  asset,
};

function liveClient(receivedByLoan: Readonly<Record<string, bigint>> = {}) {
  return {
    getBlock: vi.fn().mockResolvedValue({
      number: 100n,
      hash: blockHash,
      timestamp: 1_000n,
    }),
    readContract: vi.fn().mockImplementation(async (request: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const loanId = request.args?.[0] as bigint | undefined;
      switch (request.functionName) {
        case "loans":
          return [account, (loanId ?? 0n) + 10n, 100n, 100n, 0n, false];
        case "loanPools":
          return [account, 1_000, market, 10n];
        case "loanPoolContributions":
          return 10n;
        case "loanPoolReceived":
          return receivedByLoan[String(loanId)] ?? 0n;
        case "withdrawableAmountOf":
          return 0n;
        default:
          throw new Error(`Unhandled read ${request.functionName}`);
      }
    }),
  };
}

function runtime(): ActionExecutionRuntime {
  return {
    getIdentity: vi.fn(async () => identity),
    authorize: vi.fn(async () => {
      throw new Error("Claim All rows have no authorization step");
    }),
    simulate: vi.fn(async (request) => ({ request })),
    submit: vi.fn(async () => hash),
    waitForReceipt: vi.fn(async () => ({
      transactionHash: hash,
      status: "success" as const,
      blockNumber: 101n,
    })),
    refresh: vi.fn(async () => undefined),
  };
}

describe("Claim All U6 row execution plans", () => {
  it("rebuilds every grouped constituent at one captured block and submits one executor-owned multicall", async () => {
    const client = liveClient();
    const execution = runtime();
    const plan = createClaimAllRowExecutionPlan(row, identity, scope, client);

    const result = await runActionExecution(plan, execution);

    expect(result.status).toBe("success");
    expect(client.getBlock).toHaveBeenCalledTimes(1);
    expect(plan.accepted.action.call.functionName).toBe("multicall");
    expect(plan.accepted.action.call.calls).toHaveLength(2);
    expect(execution.simulate).toHaveBeenCalledTimes(1);
    expect(execution.submit).toHaveBeenCalledTimes(1);
    expect(execution.refresh).toHaveBeenCalledTimes(1);
  });

  it("returns needs-review before simulation when one grouped constituent changes", async () => {
    const client = liveClient({ "2": 1n });
    const execution = runtime();
    const plan = createClaimAllRowExecutionPlan(row, identity, scope, client);

    const result = await runActionExecution(plan, execution);

    expect(result.status).toBe("needs_review");
    expect(execution.simulate).not.toHaveBeenCalled();
    expect(execution.submit).not.toHaveBeenCalled();
  });

  it("returns only nothing-claimable errors when every grouped constituent disappears", async () => {
    const client = liveClient({ "1": 100n, "2": 100n });
    const plan = createClaimAllRowExecutionPlan(row, identity, scope, client);

    const rebuilt = await plan.rebuild(identity);

    expect(rebuilt).toEqual({
      status: "invalid",
      errors: [
        {
          code: "nothing-claimable",
          message: "No pool share is currently claimable",
        },
        {
          code: "nothing-claimable",
          message: "No pool share is currently claimable",
        },
      ],
    });
  });
});
