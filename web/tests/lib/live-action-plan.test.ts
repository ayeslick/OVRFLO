import { encodeFunctionData, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { ovrfloLendingAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { applySlippageDown } from "@/lib/modal-logic";
import {
  createLiveExecutionPlan,
  type LiveMarketScope,
  type LiveWriteArgs,
} from "@/lib/live-action-plan";
import type { ActionIdentity } from "@/lib/actions/types";

const WAD = 10n ** 18n;
const account = "0x00000000000000000000000000000000000000a1" as Address;
const vault = "0x00000000000000000000000000000000000000b2" as Address;
const lending = "0x00000000000000000000000000000000000000c3" as Address;
const market = "0x00000000000000000000000000000000000000d4" as Address;
const underlying = "0x00000000000000000000000000000000000000e5" as Address;
const ovrfloToken = "0x00000000000000000000000000000000000000f6" as Address;
const ptToken = "0x0000000000000000000000000000000000000017" as Address;
const other = "0x0000000000000000000000000000000000000028" as Address;
const blockHash = `0x${"11".repeat(32)}` as const;

const identity: ActionIdentity = { account, chainId: 1 };
const scope: LiveMarketScope = {
  vault,
  lending,
  market,
  underlying,
  ovrfloToken,
  ptToken,
  expiryCached: 2_000n,
};

function client({
  aprMinBps = 100,
  aprMaxBps = 5_000,
}: {
  aprMinBps?: number;
  aprMaxBps?: number;
} = {}) {
  return {
    getBlock: vi.fn().mockResolvedValue({
      number: 100n,
      hash: blockHash,
      timestamp: 1_000n,
    }),
    readContract: vi.fn().mockImplementation(async (request: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const args = request.args ?? [];
      switch (request.functionName) {
        case "balanceOf":
          return 1_000n * WAD;
        case "allowance":
          return 0n;
        case "aprMinBps":
          return aprMinBps;
        case "aprMaxBps":
          return aprMaxBps;
        case "liquidityPositions":
          return [args[0] === 4n || args[0] === 5n ? other : account, market, 1_000, 10n * WAD];
        case "loans":
          return [account, 3n, 100n * WAD, 0n, 0n, false];
        case "loanPools":
          return [account, 1_000, market, 10n * WAD];
        case "loanPoolContributions":
          return 10n * WAD;
        case "loanPoolReceived":
          return 0n;
        case "withdrawableAmountOf":
          return 100n * WAD;
        case "marketDepositLimits":
          return 1_000n * WAD;
        case "marketTotalDeposited":
          return 10n * WAD;
        case "previewDeposit": {
          const deposited = args[1] as bigint;
          return [deposited, 0n, 0n, WAD];
        }
        case "claimablePt":
          return 1_000n * WAD;
        case "wrappedUnderlying":
          return 1_000n * WAD;
        case "getRecipient":
          return account;
        case "getApproved":
          return lending;
        case "isApprovedForAll":
          return false;
        case "quote": {
          const borrowed = args[3] as bigint;
          return [borrowed, borrowed + WAD, 0n, borrowed, WAD];
        }
        case "MAX_ROUTE_IDS":
          return 128n;
        default:
          throw new Error(`Unhandled read ${request.functionName}`);
      }
    }),
  };
}

const projectedRoute = vi.fn().mockResolvedValue({
  positions: [
    {
      id: 4n,
      lender: other,
      market,
      aprBps: 1_000,
      availableLiquidity: 10n * WAD,
    },
  ],
  aggregateDepth: 10n * WAD,
});

function adjustCall(positionId = 1n, newAprBps = 1_100): LiveWriteArgs {
  return {
    address: lending,
    functionName: "multicall",
    args: [[
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "withdrawLiquidity",
        args: [positionId],
      }),
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "supplyLiquidity",
        args: [market, newAprBps, 10n * WAD],
      }),
    ]],
  };
}

const calls: Array<[string, LiveWriteArgs]> = [
  ["supply", {
    address: lending,
    functionName: "supplyLiquidity",
    args: [market, 1_000, 4n * WAD],
  }],
  ["withdraw", {
    address: lending,
    functionName: "withdrawLiquidity",
    args: [1n],
  }],
  ["claim_share", {
    address: lending,
    functionName: "claimLoanPoolShare",
    args: [2n, (1n << 128n) - 1n],
  }],
  ["deposit", {
    address: vault,
    functionName: "deposit",
    args: [market, 4n * WAD, applySlippageDown(4n * WAD)],
  }],
  ["claim_matured", {
    address: vault,
    functionName: "claim",
    args: [ptToken, 4n * WAD],
  }],
  ["wrap", {
    address: vault,
    functionName: "wrap",
    args: [4n * WAD],
  }],
  ["unwrap", {
    address: vault,
    functionName: "unwrap",
    args: [4n * WAD],
  }],
  ["borrow", {
    address: lending,
    functionName: "createBorrowerLoanPool",
    args: [[4n], 3n, 4n * WAD, 4n * WAD],
  }],
  ["claim_stream", {
    address: SABLIER_LOCKUP_ADDRESS,
    functionName: "withdrawMax",
    args: [3n, account],
  }],
  ["adjust_rate", adjustCall()],
  ["repay", {
    address: lending,
    functionName: "repayLoan",
    args: [2n, 4n * WAD],
  }],
  ["close", {
    address: lending,
    functionName: "closeLoan",
    args: [2n],
  }],
];

describe("live action execution plans", () => {
  for (const [type, raw] of calls) {
    it(`builds and freshly rebuilds ${type} through its U5 definition`, async () => {
      const actionScope =
        type === "claim_matured" ? { ...scope, expiryCached: 500n } : scope;
      const prepared = await createLiveExecutionPlan(
        raw,
        identity,
        actionScope,
        client() as never,
        projectedRoute,
      );

      expect(prepared?.status).toBe("ready");
      if (!prepared || prepared.status !== "ready") throw new Error("expected ready plan");
      expect(prepared.plan.accepted.action.type).toBe(type);
      expect(prepared.plan.accepted.action.preconditions).not.toContain("legacy-adapter");
      expect(prepared.plan.accepted.request).toMatchObject({
        address: raw.address,
        functionName: raw.functionName,
        args: raw.args,
      });

      const rebuilt = await prepared.plan.rebuild(identity);
      expect(rebuilt.status).toBe("ready");
      if (rebuilt.status !== "ready") throw new Error("expected fresh rebuild");
      expect(rebuilt.draft.action.type).toBe(type);
    });
  }

  it("fails closed when the fresh projected route cannot fill a borrow", async () => {
    const raw = calls.find(([type]) => type === "borrow")![1];

    await expect(
      createLiveExecutionPlan(raw, identity, scope, client() as never, async () => ({
        positions: [],
        aggregateDepth: 0n,
      })),
    ).rejects.toThrow(/cannot fill/i);
  });

  it("requires renewed review when the fresh projection selects another route", async () => {
    const raw = calls.find(([type]) => type === "borrow")![1];

    const prepared = await createLiveExecutionPlan(
      raw,
      identity,
      scope,
      client() as never,
      async () => ({
        positions: [
          {
            id: 5n,
            lender: other,
            market,
            aprBps: 1_000,
            availableLiquidity: 10n * WAD,
          },
        ],
        aggregateDepth: 10n * WAD,
      }),
    );

    expect(prepared?.status).toBe("needs_review");
    if (!prepared || prepared.status !== "needs_review") {
      throw new Error("expected renewed review");
    }
    expect(prepared.draft.action.review.route?.ids).toEqual([5n]);
  });

  it("fails closed when projected Borrow hydration is unavailable", async () => {
    const raw = calls.find(([type]) => type === "borrow")![1];

    await expect(
      createLiveExecutionPlan(raw, identity, scope, client() as never, async () => {
        throw new Error("Projected position could not be hydrated");
      }),
    ).rejects.toThrow(/could not be hydrated/i);
  });

  it("quotes a projected old-tick route even after configured APR bounds move past it", async () => {
    const raw = calls.find(([type]) => type === "borrow")![1];
    const liveClient = client({ aprMinBps: 1_100, aprMaxBps: 1_200 });

    const prepared = await createLiveExecutionPlan(
      raw,
      identity,
      scope,
      liveClient as never,
      projectedRoute,
    );

    expect(prepared?.status).toBe("ready");
    expect(liveClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "quote",
        args: [market, 3n, 1_000, 4n * WAD],
      }),
    );
  });

  it("requires renewed review when the fresh definition changes submitted calldata", async () => {
    const raw: LiveWriteArgs = {
      address: vault,
      functionName: "deposit",
      args: [market, 4n * WAD, 0n],
    };

    const prepared = await createLiveExecutionPlan(raw, identity, scope, client() as never);

    expect(prepared?.status).toBe("needs_review");
  });
});
