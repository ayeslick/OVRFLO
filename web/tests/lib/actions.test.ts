import { encodeFunctionData, type Address } from "viem";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { readyOutcome } from "@/lib/read-outcome";
import { MAX_UINT128, WAD } from "@/lib/lending-math";
import type { LiquidityPosition, Loan } from "@/lib/types";
import {
  ACTION_TYPES,
  actionRegistry,
  buildAction,
  revalidateReview,
} from "@/lib/actions/registry";
import { CLAIM_PAIRS_PER_TX, maturedClaimCapacity, maturedClaimMax } from "@/lib/actions/claim";
import { permissionCalldata } from "@/lib/actions/types";
import { PENDLE_ROUTER_V4 } from "@/lib/hosted-convert";
import { hostedConvertResponse } from "./hosted-convert.fixture";
import type {
  ActionIntent,
  ActionSnapshot,
  MarketActionContext,
  ReadyAction,
} from "@/lib/actions/types";

const account = "0x00000000000000000000000000000000000000a1" as Address;
const other = "0x00000000000000000000000000000000000000b2" as Address;
const marketAddress = "0x00000000000000000000000000000000000000c3" as Address;
const vault = "0x00000000000000000000000000000000000000d4" as Address;
const lending = "0x00000000000000000000000000000000000000e5" as Address;
const underlying = "0x00000000000000000000000000000000000000f6" as Address;
const ovrfloToken = "0x0000000000000000000000000000000000000017" as Address;
const ptToken = "0x0000000000000000000000000000000000000028" as Address;
const sablier = "0x0000000000000000000000000000000000000039" as Address;
const reserve = "0x000000000000000000000000000000000000004a" as Address;

const market: MarketActionContext = {
  vault,
  lending,
  market: marketAddress,
  underlying,
  ovrfloToken,
  ptToken,
  sablier,
  expiry: 2_000n,
  now: 1_000n,
  reserve,
};

const identity = { account, chainId: 1 };
const fresh = <T,>(
  data: T,
  blockNumber = 100n,
  blockHash?: `0x${string}`,
) =>
  readyOutcome(data, {
    scopeKey: "actions:test",
    blockNumber,
    ...(blockHash ? { blockHash } : {}),
  });

const loan: Loan = {
  id: 21n,
  borrower: account,
  streamId: 31n,
  obligation: 100n * WAD,
  drawn: 20n * WAD,
  repaid: 10n * WAD,
  closed: false,
};

const position = (
  id: bigint,
  availableLiquidity: bigint,
  lenderAddress: Address = other,
): LiquidityPosition => ({
  id,
  lender: lenderAddress,
  market: marketAddress,
  aprBps: 1_000,
  availableLiquidity,
});

const cases: Array<{ intent: ActionIntent; snapshot: ActionSnapshot }> = [
  {
    intent: { type: "supply", amount: "10", aprBps: 1_000 },
    snapshot: {
      type: "supply",
      identity,
      market,
      state: fresh({ walletBalance: 20n * WAD, allowance: 0n, aprMinBps: 500, aprMaxBps: 2_000 }),
    },
  },
  {
    intent: { type: "withdraw", positionId: 7n },
    snapshot: {
      type: "withdraw",
      identity,
      market,
      state: fresh({ position: position(7n, 10n * WAD, account) }),
    },
  },
  {
    intent: { type: "claim_share", loanId: 21n },
    snapshot: {
      type: "claim_share",
      identity,
      market,
      state: fresh({ loanId: 21n, claimable: 5n * WAD }),
    },
  },
  {
    intent: { type: "claim_position", positionId: 7n },
    snapshot: {
      type: "claim_position",
      identity,
      market,
      state: fresh({
        positionId: 7n,
        pairs: [
          { loanId: 21n, claimable: 3n * WAD },
          { loanId: 22n, claimable: 2n * WAD },
        ],
        truncated: false,
      }),
    },
  },
  {
    intent: { type: "deposit", amount: "10" },
    snapshot: {
      type: "deposit",
      identity,
      market,
      state: fresh({
        walletBalance: 20n * WAD,
        ptAllowance: 0n,
        underlyingAllowance: 0n,
        capLimit: 100n * WAD,
        capUsed: 20n * WAD,
        preview: {
          amount: 10n * WAD,
          toWallet: 8n * WAD,
          toStream: 2n * WAD,
          fee: WAD / 100n,
          minToWallet: (8n * WAD * 9_950n) / 10_000n,
        },
      }),
    },
  },
  {
    intent: { type: "claim_matured", amount: "4" },
    snapshot: {
      type: "claim_matured",
      identity,
      market: { ...market, now: 2_000n },
      state: fresh({
        walletBalance: 9n * WAD,
        claimablePt: 6n * WAD,
        marketTotalDeposited: 4n * WAD,
      }),
    },
  },
  {
    intent: { type: "wrap", amount: "2" },
    snapshot: {
      type: "wrap",
      identity,
      market,
      state: fresh({ walletBalance: 3n * WAD, allowance: 0n }),
    },
  },
  {
    intent: { type: "unwrap", amount: "2" },
    snapshot: {
      type: "unwrap",
      identity,
      market,
      state: fresh({ walletBalance: 3n * WAD, wrapReserve: 2n * WAD }),
    },
  },
  {
    intent: { type: "borrow", amount: "4", streamId: 31n },
    snapshot: {
      type: "borrow",
      identity,
      market,
      stream: fresh({
        streamId: 31n,
        recipient: account,
        approved: null,
        approvedForAll: false,
        eligible: true,
      }),
      routing: fresh({
        market: marketAddress,
        aprBps: 1_000,
        candidateIds: [3n, 2n, 4n],
        aggregateDepth: 12n * WAD,
        maxRouteIds: 8,
      }),
      hydration: fresh({
        positions: [position(2n, 3n * WAD, account), position(3n, 0n), position(4n, 9n * WAD)],
      }),
      quote: fresh({
        market: marketAddress,
        streamId: 31n,
        aprBps: 1_000,
        amount: 4n * WAD,
        actualBorrow: 4n * WAD,
        feeAmount: (4n * WAD * 25n) / 10_000n,
        obligation: 5n * WAD,
        residual: WAD,
        minAcceptable: (4n * WAD * 9_925n) / 10_000n,
      }),
    },
  },
  {
    intent: { type: "claim_stream", streamId: 31n },
    snapshot: {
      type: "claim_stream",
      identity,
      market,
      state: fresh({ streamId: 31n, recipient: account, withdrawable: WAD }),
    },
  },
  {
    intent: { type: "adjust_rate", positionId: 7n, newAprBps: 1_100 },
    snapshot: {
      type: "adjust_rate",
      identity,
      market,
      state: fresh({
        position: position(7n, 10n * WAD, account),
        allowance: 0n,
        aprMinBps: 500,
        aprMaxBps: 2_000,
      }),
    },
  },
  {
    intent: { type: "repay", loanId: 21n, amount: "5" },
    snapshot: {
      type: "repay",
      identity,
      market,
      state: fresh({ loan, walletBalance: 10n * WAD, allowance: 0n }),
    },
  },
  {
    intent: { type: "close", loanId: 21n },
    snapshot: {
      type: "close",
      identity,
      market,
      state: fresh({ loan, withdrawable: 70n * WAD }),
    },
  },
  {
    intent: {
      type: "hosted_convert",
      amount: "10",
      inputToken: underlying,
      outputToken: ptToken,
      slippageBps: 50,
      enableAggregator: false,
    },
    snapshot: {
      type: "hosted_convert",
      identity,
      market,
      state: fresh({
        response: hostedConvertResponse({
          account,
          inputToken: underlying,
          outputToken: ptToken,
          pendleMarket: marketAddress,
          amount: 10n * WAD,
        }),
        now: 1_700_000_000n,
        walletBalance: 20n * WAD,
        allowance: 0n,
        disclosure: "default",
      }),
    },
  },
];

function expectReady(intent: ActionIntent, snapshot: ActionSnapshot): ReadyAction {
  const result = buildAction(intent, snapshot);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.errors.map((error) => error.message).join(", "));
  return result.action;
}

describe("pure action registry", () => {
  it("resolves all fourteen ActionType values exactly once", () => {
    expect(ACTION_TYPES).toEqual([
      "supply",
      "withdraw",
      "claim_share",
      "claim_position",
      "deposit",
      "claim_matured",
      "wrap",
      "unwrap",
      "borrow",
      "claim_stream",
      "adjust_rate",
      "repay",
      "close",
      "hosted_convert",
    ]);
    expect(Object.keys(actionRegistry).sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(Object.values(actionRegistry).map((definition) => definition.type)).size).toBe(14);
  });

  it("builds one ready pure action for every existing action type", () => {
    expect(cases.map(({ intent, snapshot }) => expectReady(intent, snapshot).type)).toEqual(ACTION_TYPES);
  });

  it("builds Hosted Convert as a Router V4 call with decoded calldata", () => {
    const hosted = cases.find(({ intent }) => intent.type === "hosted_convert")!;
    const action = expectReady(hosted.intent, hosted.snapshot);
    expect(action.call.contract).toBe("pendle_router");
    expect(action.call.target).toBe(PENDLE_ROUTER_V4);
    expect(action.call.data).toMatch(/^0x/);
    expect(action.call.functionName).toBe("hostedConvert");
  });
});

describe("amount validity before authorization planning or call construction (AE5)", () => {
  for (const amount of ["", "0", "-1", "abc", "1e18", "1.0000000000000000001"]) {
    it(`rejects ${JSON.stringify(amount)} without a call or authorization plan`, () => {
      const base = cases[0]!;
      if (!base) throw new Error("missing supply fixture");
      const result = buildAction({ type: "supply", amount, aprBps: 1_000 }, base.snapshot);
      expect(result).toMatchObject({ status: "invalid" });
      expect(result).not.toHaveProperty("action");
    });
  }

  const amountCases = cases.filter(
    (entry): entry is typeof entry & { intent: ActionIntent & { amount: string } } =>
      "amount" in entry.intent,
  );
  for (const { intent, snapshot } of amountCases) {
    for (const amount of ["0", "-1", "abc"]) {
      it(`rejects ${intent.type} amount ${JSON.stringify(amount)} before producing an action`, () => {
        const invalidIntent = { ...intent, amount } as ActionIntent;
        const result = buildAction(invalidIntent, snapshot);
        expect(result.status).toBe("invalid");
        expect(result).not.toHaveProperty("action");
      });
    }
  }

  it("rejects an over-cap matured claim before producing a call or approvals", () => {
    const claim = cases.find(({ intent }) => intent.type === "claim_matured")!;
    const result = buildAction({ type: "claim_matured", amount: "4.000000000000000001" }, claim.snapshot);
    expect(result).toMatchObject({
      status: "invalid",
      errors: [{ code: "amount-over-capacity" }],
    });
    expect(result).not.toHaveProperty("action");
  });

  it("rejects deposit capacity before accepting a mismatched preview", () => {
    const deposit = cases.find(({ intent }) => intent.type === "deposit")!;
    if (deposit.snapshot.type !== "deposit") throw new Error("wrong fixture");
    const result = buildAction({ type: "deposit", amount: "81" }, {
      ...deposit.snapshot,
      state: fresh({
        ...deposit.snapshot.state.data!,
        walletBalance: 100n * WAD,
      }),
    });
    expect(result).toMatchObject({
      status: "invalid",
      errors: [{ code: "amount-over-capacity" }],
    });
    expect(result).not.toHaveProperty("action");
  });
});

describe("matured claim capacity", () => {
  it("uses the fresh minimum of wallet balance, claimable PT, and market total deposited for MAX", () => {
    const state = {
      walletBalance: 9n * WAD,
      claimablePt: 6n * WAD,
      marketTotalDeposited: 4n * WAD,
    };
    expect(maturedClaimCapacity(state)).toBe(4n * WAD);
    const claim = cases.find(({ intent }) => intent.type === "claim_matured")!;
    if (claim.snapshot.type !== "claim_matured") throw new Error("wrong fixture");
    expect(maturedClaimMax(claim.snapshot)).toBe(4n * WAD);
  });

  it("does not expose MAX from stale claim state", () => {
    const claim = cases.find(({ intent }) => intent.type === "claim_matured")!;
    if (claim.snapshot.type !== "claim_matured") throw new Error("wrong fixture");
    expect(
      maturedClaimMax({
        ...claim.snapshot,
        state: readyOutcome(claim.snapshot.state.data!, {}, "stale"),
      }),
    ).toBeNull();
  });
});

describe("Borrow projected-route definitions", () => {
  it("replaces a consumed candidate with fresh hydrated backup liquidity and freezes ascending ids", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    const action = expectReady(borrow.intent, borrow.snapshot);
    expect(action.call).toMatchObject({
      functionName: "borrow",
      args: [marketAddress, 1_000, 4n * WAD, 31n, (4n * WAD * 9_925n) / 10_000n, account],
    });
    expect(action.review.route).toEqual({
      ids: [4n],
      amounts: [9n * WAD],
      aprBps: 1_000,
    });
  });

  it("freezes unique selected liquidity ids in strict ascending order", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");
    const action = expectReady(
      { type: "borrow", amount: "10", streamId: 31n },
      {
        ...borrow.snapshot,
        routing: fresh({
          ...borrow.snapshot.routing.data!,
          candidateIds: [5n, 2n, 4n, 3n],
          aggregateDepth: 15n * WAD,
        }),
        hydration: fresh({
          positions: [
            position(5n, 3n * WAD),
            position(2n, 3n * WAD, account),
            position(4n, 9n * WAD),
            position(3n, 0n),
          ],
        }),
        quote: fresh({
          ...borrow.snapshot.quote.data!,
          amount: 10n * WAD,
          actualBorrow: 10n * WAD,
          feeAmount: 25_000_000_000_000_000n,
          obligation: 11n * WAD,
          residual: WAD,
          minAcceptable: 9_925_000_000_000_000_000n,
        }),
      },
    );
    expect(action.review.route?.ids).toEqual([4n, 5n]);
  });

  it("reports incomplete when a projected candidate lacks fresh hydration", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");
    const result = buildAction(borrow.intent, {
      ...borrow.snapshot,
      hydration: fresh({ positions: [position(2n, 3n * WAD, account), position(4n, 9n * WAD)] }),
    });
    expect(result).toMatchObject({
      status: "invalid",
      errors: [{ code: "routing-incomplete" }],
    });
  });

  it("requires complete fresh routing, hydration, quote, and stream snapshots at one block", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");
    const result = buildAction(borrow.intent, {
      ...borrow.snapshot,
      hydration: readyOutcome(borrow.snapshot.hydration.data!, { blockNumber: 101n }),
    });
    expect(result).toMatchObject({
      status: "invalid",
      errors: [{ code: "snapshot-block-mismatch" }],
    });
  });

  it("rejects equal-height borrow outcomes from different block hashes", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");
    const result = buildAction(borrow.intent, {
      ...borrow.snapshot,
      quote: fresh(
        borrow.snapshot.quote.data!,
        100n,
        `0x${"11".repeat(32)}`,
      ),
    });
    expect(result).toMatchObject({
      status: "invalid",
      errors: [{ code: "snapshot-block-mismatch" }],
    });
  });

  it.each([
    [
      "stream",
      (snapshot: Extract<ActionSnapshot, { type: "borrow" }>) => ({
        ...snapshot,
        stream: fresh({ ...snapshot.stream.data!, streamId: 99n }),
      }),
    ],
    [
      "route",
      (snapshot: Extract<ActionSnapshot, { type: "borrow" }>) => ({
        ...snapshot,
        routing: fresh({ ...snapshot.routing.data!, market: other }),
      }),
    ],
    [
      "quote",
      (snapshot: Extract<ActionSnapshot, { type: "borrow" }>) => ({
        ...snapshot,
        quote: fresh({ ...snapshot.quote.data!, amount: 5n * WAD }),
      }),
    ],
  ])("rejects a fresh same-block %s snapshot for another resource", (_name, mutate) => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");
    expect(buildAction(borrow.intent, mutate(borrow.snapshot))).toMatchObject({
      status: "invalid",
      errors: [{ code: "snapshot-resource-mismatch" }],
    });
  });
});

describe("authorization planning", () => {
  it("authorizes only PT for deposit, even when a fee is quoted", () => {
    const deposit = cases.find(({ intent }) => intent.type === "deposit")!;
    if (deposit.snapshot.type !== "deposit") throw new Error("wrong fixture");
    const action = expectReady(deposit.intent, {
      ...deposit.snapshot,
      state: fresh({
        ...deposit.snapshot.state.data!,
        ptAllowance: 10n * WAD,
        underlyingAllowance: 0n,
      }),
    });
    expect(action.authorizations).toEqual([
      expect.objectContaining({
        kind: "erc20",
        token: ptToken,
        spender: vault,
        requiredAmount: 10n * WAD,
        satisfied: true,
      }),
    ]);
    expect(action.authorizations).not.toContainEqual(expect.objectContaining({ token: underlying }));
  });

  it("wraps against the reserve and spends exact underlying", () => {
    const wrap = cases.find(({ intent }) => intent.type === "wrap")!;
    const action = expectReady(wrap.intent, wrap.snapshot);
    expect(action.call).toMatchObject({
      target: reserve,
      contract: "reserve",
      functionName: "wrap",
    });
    expect(action.authorizations).toEqual([
      expect.objectContaining({
        kind: "erc20",
        token: underlying,
        spender: reserve,
        requiredAmount: 2n * WAD,
      }),
    ]);
  });

  it("supplies ovrfloToken, not underlying", () => {
    const supply = cases.find(({ intent }) => intent.type === "supply")!;
    const action = expectReady(supply.intent, supply.snapshot);
    expect(action.authorizations).toEqual([
      expect.objectContaining({
        kind: "erc20",
        token: ovrfloToken,
        spender: lending,
      }),
    ]);
  });

  it("adjust-rate authorizes ovrfloToken for the nested supply", () => {
    const adjust = cases.find(({ intent }) => intent.type === "adjust_rate")!;
    const action = expectReady(adjust.intent, adjust.snapshot);
    expect(action.authorizations).toEqual([
      expect.objectContaining({
        kind: "erc20",
        token: ovrfloToken,
        spender: lending,
      }),
    ]);
    expect(action.authorizations).not.toContainEqual(expect.objectContaining({ token: underlying }));
  });
});

describe("frozen review revalidation (AE6)", () => {
  it("does not replace review when an accepted authorization merely becomes satisfied", () => {
    const supply = cases[0]!;
    if (!supply) throw new Error("missing supply fixture");
    const reviewed = expectReady(supply.intent, supply.snapshot);
    if (supply.snapshot.type !== "supply") throw new Error("wrong fixture");
    const rebuilt = expectReady(supply.intent, {
      ...supply.snapshot,
      state: fresh({ ...supply.snapshot.state.data!, allowance: 10n * WAD }),
    });
    expect(revalidateReview(reviewed.review, rebuilt.review)).toEqual({ status: "accepted" });
  });

  it("replaces review for material call, route, authorization, or economic changes", () => {
    const borrow = cases.find(({ intent }) => intent.type === "borrow")!;
    const reviewed = expectReady(borrow.intent, borrow.snapshot);
    if (borrow.snapshot.type !== "borrow") throw new Error("wrong fixture");

    const routeChanged = expectReady(borrow.intent, {
      ...borrow.snapshot,
      routing: fresh({
        ...borrow.snapshot.routing.data!,
        candidateIds: [3n, 2n, 5n],
      }),
      hydration: fresh({
        positions: [position(2n, 3n * WAD, account), position(3n, 0n), position(5n, 9n * WAD)],
      }),
    });
    expect(revalidateReview(reviewed.review, routeChanged.review)).toMatchObject({ status: "needs-review" });

    const economicsChanged = expectReady(borrow.intent, {
      ...borrow.snapshot,
      quote: fresh({ ...borrow.snapshot.quote.data!, actualBorrow: 3_980_000_000_000_000_000n }),
    });
    expect(revalidateReview(reviewed.review, economicsChanged.review)).toMatchObject({ status: "needs-review" });

    const supply = cases[0]!;
    if (!supply) throw new Error("missing supply fixture");
    const supplyReviewed = expectReady(supply.intent, supply.snapshot);
    if (supply.snapshot.type !== "supply") throw new Error("wrong fixture");
    const authorizationChanged = expectReady({ type: "supply", amount: "11", aprBps: 1_000 }, {
      ...supply.snapshot,
      state: fresh({ ...supply.snapshot.state.data!, walletBalance: 20n * WAD }),
    });
    expect(revalidateReview(supplyReviewed.review, authorizationChanged.review)).toMatchObject({
      status: "needs-review",
    });
  });
});

describe("PERMISSION RECEIPT see-equals-sign", () => {
  it("encodes ERC-20 approval calldata byte-equal to the authorization amount", () => {
    const supply = cases.find(({ intent }) => intent.type === "supply")!;
    const action = expectReady(supply.intent, supply.snapshot);
    const authorization = action.authorizations[0];
    if (!authorization || authorization.kind !== "erc20") throw new Error("expected erc20 auth");
    expect(permissionCalldata(authorization)).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [authorization.spender, authorization.approvalAmount],
      }),
    );
  });

  it("encodes the action call byte-equal to reviewed args", () => {
    const supply = cases.find(({ intent }) => intent.type === "supply")!;
    const action = expectReady(supply.intent, supply.snapshot);
    expect(
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "supply",
        args: action.call.args as [Address, number, bigint],
      }),
    ).toBe(
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: action.call.functionName as "supply",
        args: [marketAddress, 1_000, 10n * WAD],
      }),
    );
  });
});

describe("per-position claim", () => {
  it("batches claimable pairs through Multicall with the uint128 max sentinel", () => {
    const claim = cases.find(({ intent }) => intent.type === "claim_position")!;
    const action = expectReady(claim.intent, claim.snapshot);
    expect(action.call.functionName).toBe("multicall");
    const encoded = action.call.args[0] as readonly `0x${string}`[];
    expect(encoded).toHaveLength(2);
    for (const data of encoded) {
      const decoded = encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "claim",
        args: [21n, 7n, MAX_UINT128],
      });
      expect(typeof data).toBe("string");
      expect(data.startsWith("0x")).toBe(true);
      void decoded;
    }
    const first = encoded[0]!;
    expect(first).toBe(
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "claim",
        args: [21n, 7n, MAX_UINT128],
      }),
    );
  });

  it("caps pairs per transaction and marks remaining", () => {
    expect(CLAIM_PAIRS_PER_TX).toBe(32);
    const pairs = Array.from({ length: 40 }, (_, index) => ({
      loanId: BigInt(index + 1),
      claimable: WAD,
    }));
    const action = expectReady(
      { type: "claim_position", positionId: 7n },
      {
        type: "claim_position",
        identity,
        market,
        state: fresh({ positionId: 7n, pairs, truncated: false }),
      },
    );
    expect(action.call.functionName).toBe("multicall");
    expect((action.call.args[0] as readonly unknown[]).length).toBe(CLAIM_PAIRS_PER_TX);
    expect(action.review.economics.truncated).toBe(true);
  });
});

describe("pure dependency boundary", () => {
  it("contains no React, wallet, TanStack, Ponder, gatherLiquidity, or query dependency", () => {
    const actionsDirectory = resolve(process.cwd(), "lib", "actions");
    for (const file of readdirSync(actionsDirectory).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(resolve(actionsDirectory, file), "utf8");
      expect(source).not.toMatch(
        /(?:from\s+["'](?:react|wagmi|@tanstack)|use(?:Read|Write|Query|Wallet)|ponder|gatherLiquidity|queryKey)/i,
      );
    }
  });
});
