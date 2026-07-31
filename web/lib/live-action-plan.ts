import {
  decodeFunctionData,
  formatUnits,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "./abis";
import {
  actionResultToDraft,
  type ActionExecutionDraft,
  type ExactSimulationRequest,
  type ExecutionPlan,
} from "./action-runtime";
import { buildAction } from "./actions/registry";
import type {
  ActionBuildResult,
  ActionIdentity,
  ActionIntent,
  ActionSnapshot,
  MarketActionContext,
  ReadyAction,
} from "./actions/types";
import { applySlippageDown } from "./modal-logic";
import { SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "./config";
import {
  loanPoolClaimable,
  recoveredForClaimable,
} from "./lending-math";
import { readyOutcome } from "./read-outcome";
import type { LiquidityPosition, Loan, MarketInfo } from "./types";

export type LiveMarketScope = Pick<
  MarketInfo,
  | "vault"
  | "lending"
  | "market"
  | "underlying"
  | "ovrfloToken"
  | "ptToken"
  | "expiryCached"
>;

export type LiveWriteArgs = {
  address?: Address;
  functionName?: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type LiveClient = Pick<PublicClient, "getBlock" | "readContract">;
export type LiveBlockSnapshot = {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
};
export type LiveBorrowProjectionLoader = (input: {
  lending: Address;
  market: Address;
  aprBps: number;
  block: LiveBlockSnapshot;
}) => Promise<{
  positions: readonly LiquidityPosition[];
  aggregateDepth: bigint;
}>;
type LiveSnapshotOptions = {
  pinnedBlock?: LiveBlockSnapshot;
  loadBorrowProjection?: LiveBorrowProjectionLoader;
};

type ParsedAction = {
  intent: ActionIntent;
  raw: LiveWriteArgs;
};

function amount(value: bigint): string {
  return formatUnits(value, 18);
}

function requireBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} is not a bigint`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} is not a safe integer`);
  }
  return value;
}

function parseAction(raw: LiveWriteArgs): ParsedAction | null {
  const args = raw.args ?? [];
  switch (raw.functionName) {
    case "supplyLiquidity":
      return {
        intent: {
          type: "supply",
          aprBps: requireNumber(args[1], "APR"),
          amount: amount(requireBigint(args[2], "supply amount")),
        },
        raw,
      };
    case "withdrawLiquidity":
      return {
        intent: {
          type: "withdraw",
          positionId: requireBigint(args[0], "position ID"),
        },
        raw,
      };
    case "claimLoanPoolShare":
      return {
        intent: {
          type: "claim_share",
          loanId: requireBigint(args[0], "loan ID"),
        },
        raw,
      };
    case "deposit":
      return {
        intent: {
          type: "deposit",
          amount: amount(requireBigint(args[1], "deposit amount")),
        },
        raw,
      };
    case "claim":
      return {
        intent: {
          type: "claim_matured",
          amount: amount(requireBigint(args[1], "claim amount")),
        },
        raw,
      };
    case "wrap":
      return {
        intent: {
          type: "wrap",
          amount: amount(requireBigint(args[0], "wrap amount")),
        },
        raw,
      };
    case "unwrap":
      return {
        intent: {
          type: "unwrap",
          amount: amount(requireBigint(args[0], "unwrap amount")),
        },
        raw,
      };
    case "createBorrowerLoanPool":
      return {
        intent: {
          type: "borrow",
          streamId: requireBigint(args[1], "stream ID"),
          amount: amount(requireBigint(args[2], "borrow amount")),
        },
        raw,
      };
    case "withdrawMax":
      return {
        intent: {
          type: "claim_stream",
          streamId: requireBigint(args[0], "stream ID"),
        },
        raw,
      };
    case "multicall": {
      const calls = args[0];
      if (!Array.isArray(calls)) throw new Error("multicall children are missing");
      let positionId: bigint | undefined;
      let newAprBps: number | undefined;
      for (const call of calls) {
        if (typeof call !== "string") continue;
        const decoded = decodeFunctionData({
          abi: ovrfloLendingAbi,
          data: call as `0x${string}`,
        });
        if (decoded.functionName === "withdrawLiquidity") {
          positionId = decoded.args[0];
        } else if (decoded.functionName === "supplyLiquidity") {
          newAprBps = decoded.args[1];
        }
      }
      if (positionId === undefined || newAprBps === undefined) {
        throw new Error("adjust-rate multicall is incomplete");
      }
      return {
        intent: { type: "adjust_rate", positionId, newAprBps },
        raw,
      };
    }
    case "repayLoan":
      return {
        intent: {
          type: "repay",
          loanId: requireBigint(args[0], "loan ID"),
          amount: amount(requireBigint(args[1], "repay amount")),
        },
        raw,
      };
    case "closeLoan":
      return {
        intent: {
          type: "close",
          loanId: requireBigint(args[0], "loan ID"),
        },
        raw,
      };
    default:
      return null;
  }
}

async function read<T>(
  client: LiveClient,
  blockNumber: bigint,
  request: Record<string, unknown>,
): Promise<T> {
  return client.readContract({ ...request, blockNumber } as never) as Promise<T>;
}

async function positionAt(
  client: LiveClient,
  lending: Address,
  id: bigint,
  blockNumber: bigint,
): Promise<LiquidityPosition | null> {
  const [lender, market, aprBps, availableLiquidity] = await read<
    [Address, Address, number, bigint]
  >(client, blockNumber, {
    address: lending,
    abi: ovrfloLendingAbi,
    functionName: "liquidityPositions",
    args: [id],
  });
  return isAddressEqual(lender, ZERO_ADDRESS)
    ? null
    : { id, lender, market, aprBps, availableLiquidity };
}

async function loanAt(
  client: LiveClient,
  lending: Address,
  id: bigint,
  blockNumber: bigint,
): Promise<Loan | null> {
  const [borrower, streamId, obligation, drawn, repaid, closed] = await read<
    [Address, bigint, bigint, bigint, bigint, boolean]
  >(client, blockNumber, {
    address: lending,
    abi: ovrfloLendingAbi,
    functionName: "loans",
    args: [id],
  });
  return isAddressEqual(borrower, ZERO_ADDRESS)
    ? null
    : { id, borrower, streamId, obligation, drawn, repaid, closed };
}

function marketContext(
  scope: LiveMarketScope,
  now: bigint,
): MarketActionContext {
  return {
    vault: scope.vault,
    lending: scope.lending,
    market: scope.market,
    underlying: scope.underlying,
    ovrfloToken: scope.ovrfloToken,
    ptToken: scope.ptToken,
    sablier: SABLIER_LOCKUP_ADDRESS,
    expiry: scope.expiryCached,
    now,
  };
}

async function loadSnapshot(
  parsed: ParsedAction,
  identity: ActionIdentity,
  scope: LiveMarketScope,
  client: LiveClient,
  {
    pinnedBlock,
    loadBorrowProjection,
  }: LiveSnapshotOptions = {},
): Promise<ActionSnapshot> {
  const block = pinnedBlock ?? await client.getBlock({ blockTag: "latest" });
  if (!block.hash) throw new Error("Action snapshot block has no hash");
  const blockHash = block.hash;
  const metadata = { blockNumber: block.number, blockHash };
  const market = marketContext(scope, block.timestamp);
  const blockNumber = block.number;
  const lending = scope.lending;

  switch (parsed.intent.type) {
    case "supply": {
      if (!lending) throw new Error("Lending is not configured");
      const [walletBalance, allowance, aprMinBps, aprMaxBps] = await Promise.all([
        read<bigint>(client, blockNumber, {
          address: scope.underlying,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.underlying,
          abi: erc20Abi,
          functionName: "allowance",
          args: [identity.account, lending],
        }),
        read<number>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "aprMinBps",
        }),
        read<number>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "aprMaxBps",
        }),
      ]);
      return {
        type: "supply",
        identity,
        market,
        state: readyOutcome(
          { walletBalance, allowance, aprMinBps, aprMaxBps },
          metadata,
        ),
      };
    }
    case "withdraw": {
      if (!lending) throw new Error("Lending is not configured");
      return {
        type: "withdraw",
        identity,
        market,
        state: readyOutcome(
          { position: await positionAt(client, lending, parsed.intent.positionId, blockNumber) },
          metadata,
        ),
      };
    }
    case "claim_share": {
      if (!lending) throw new Error("Lending is not configured");
      const loanId = parsed.intent.loanId;
      const loan = await loanAt(client, lending, loanId, blockNumber);
      const [pool, contribution, received, withdrawable] = await Promise.all([
        read<[Address, number, Address, bigint]>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "loanPools",
          args: [loanId],
        }),
        read<bigint>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "loanPoolContributions",
          args: [loanId, identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "loanPoolReceived",
          args: [loanId, identity.account],
        }),
        loan
          ? read<bigint>(client, blockNumber, {
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "withdrawableAmountOf",
              args: [loan.streamId],
            })
          : Promise.resolve(0n),
      ]);
      const claimable = loan
        ? loanPoolClaimable({
            contribution,
            received,
            recovered: recoveredForClaimable({ loan, withdrawable }),
            totalContributed: pool[3],
          })
        : 0n;
      return {
        type: "claim_share",
        identity,
        market,
        state: readyOutcome({ loanId, claimable }, metadata),
      };
    }
    case "deposit": {
      const amountIn = requireBigint(parsed.raw.args?.[1], "deposit amount");
      const reviewedMin = requireBigint(parsed.raw.args?.[2], "minimum received");
      const [walletBalance, ptAllowance, underlyingAllowance, capLimit, capUsed, preview] =
        await Promise.all([
          read<bigint>(client, blockNumber, {
            address: scope.ptToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [identity.account],
          }),
          read<bigint>(client, blockNumber, {
            address: scope.ptToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [identity.account, scope.vault],
          }),
          read<bigint>(client, blockNumber, {
            address: scope.underlying,
            abi: erc20Abi,
            functionName: "allowance",
            args: [identity.account, scope.vault],
          }),
          read<bigint>(client, blockNumber, {
            address: scope.vault,
            abi: ovrfloAbi,
            functionName: "marketDepositLimits",
            args: [scope.market],
          }),
          read<bigint>(client, blockNumber, {
            address: scope.vault,
            abi: ovrfloAbi,
            functionName: "marketTotalDeposited",
            args: [scope.market],
          }),
          read<[bigint, bigint, bigint, bigint]>(client, blockNumber, {
            address: scope.vault,
            abi: ovrfloAbi,
            functionName: "previewDeposit",
            args: [scope.market, amountIn],
          }),
        ]);
      return {
        type: "deposit",
        identity,
        market,
        state: readyOutcome(
          {
            walletBalance,
            ptAllowance,
            underlyingAllowance,
            capLimit,
            capUsed,
            preview: {
              amount: amountIn,
              toWallet: preview[0],
              toStream: preview[1],
              fee: preview[2],
              // Honor the bound the user reviewed, but only while it is at
              // least as protective as the freshly-computed floor and still
              // satisfiable. Recomputing unconditionally makes every mid-flow
              // block advance change the rebuilt args and re-trip the review
              // gate; honoring unconditionally would wave a degenerate (e.g.
              // zero) bound through with no slippage protection. Outside the
              // window the recomputed bound routes to needs_review with the
              // updated number.
              minToWallet:
                reviewedMin >= applySlippageDown(preview[0]) && reviewedMin <= preview[0]
                  ? reviewedMin
                  : applySlippageDown(preview[0]),
            },
          },
          metadata,
        ),
      };
    }
    case "claim_matured": {
      const [walletBalance, claimablePt, marketTotalDeposited] = await Promise.all([
        read<bigint>(client, blockNumber, {
          address: scope.ptToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.vault,
          abi: ovrfloAbi,
          functionName: "claimablePt",
          args: [scope.ptToken],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.vault,
          abi: ovrfloAbi,
          functionName: "marketTotalDeposited",
          args: [scope.market],
        }),
      ]);
      return {
        type: "claim_matured",
        identity,
        market,
        state: readyOutcome(
          { walletBalance, claimablePt, marketTotalDeposited },
          metadata,
        ),
      };
    }
    case "wrap": {
      const [walletBalance, allowance] = await Promise.all([
        read<bigint>(client, blockNumber, {
          address: scope.underlying,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.underlying,
          abi: erc20Abi,
          functionName: "allowance",
          args: [identity.account, scope.vault],
        }),
      ]);
      return {
        type: "wrap",
        identity,
        market,
        state: readyOutcome({ walletBalance, allowance }, metadata),
      };
    }
    case "unwrap": {
      const [walletBalance, wrapReserve] = await Promise.all([
        read<bigint>(client, blockNumber, {
          address: scope.ovrfloToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.vault,
          abi: ovrfloAbi,
          functionName: "wrappedUnderlying",
        }),
      ]);
      return {
        type: "unwrap",
        identity,
        market,
        state: readyOutcome({ walletBalance, wrapReserve }, metadata),
      };
    }
    case "borrow": {
      if (!lending) throw new Error("Lending is not configured");
      if (!loadBorrowProjection) {
        throw new Error("Fresh projected borrow routing is unavailable");
      }
      const streamId = parsed.intent.streamId;
      const target = requireBigint(parsed.raw.args?.[2], "borrow amount");
      const reviewedMin = requireBigint(parsed.raw.args?.[3], "minimum received");
      const rawIds = parsed.raw.args?.[0];
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        throw new Error("Reviewed route is empty");
      }
      const reviewedFirst = await positionAt(
        client,
        lending,
        requireBigint(rawIds[0], "liquidity ID"),
        blockNumber,
      );
      if (!reviewedFirst) throw new Error("Reviewed route is no longer available");
      const aprBps = reviewedFirst.aprBps;
      const [projectedRoute, recipient, approved, approvedForAll, quote, maxRouteIds] =
        await Promise.all([
          loadBorrowProjection({
            lending,
            market: scope.market,
            aprBps,
            block: {
              number: blockNumber,
              hash: blockHash,
              timestamp: block.timestamp,
            },
          }),
          read<Address>(client, blockNumber, {
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "getRecipient",
            args: [streamId],
          }),
          read<Address>(client, blockNumber, {
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "getApproved",
            args: [streamId],
          }),
          read<boolean>(client, blockNumber, {
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "isApprovedForAll",
            args: [identity.account, lending],
          }),
          read<[bigint, bigint, bigint, bigint, bigint]>(client, blockNumber, {
            address: lending,
            abi: ovrfloLendingAbi,
            functionName: "quote",
            args: [scope.market, streamId, aprBps, target],
          }),
          read<bigint>(client, blockNumber, {
            address: lending,
            abi: ovrfloLendingAbi,
            functionName: "MAX_ROUTE_IDS",
          }),
        ]);
      if (projectedRoute.positions.length === 0) {
        throw new Error("Fresh projected liquidity cannot fill the reviewed borrow");
      }
      return {
        type: "borrow",
        identity,
        market,
        stream: readyOutcome(
          {
            streamId,
            recipient,
            approved: isAddressEqual(approved, ZERO_ADDRESS) ? null : approved,
            approvedForAll,
            eligible: true,
          },
          metadata,
        ),
        routing: readyOutcome(
          {
            market: scope.market,
            aprBps,
            candidateIds: projectedRoute.positions.map((position) => position.id),
            aggregateDepth: projectedRoute.aggregateDepth,
            maxRouteIds: Number(maxRouteIds),
          },
          metadata,
        ),
        hydration: readyOutcome(
          { positions: projectedRoute.positions },
          metadata,
        ),
        quote: readyOutcome(
          {
            market: scope.market,
            streamId,
            aprBps,
            amount: target,
            grossPrice: quote[0],
            obligation: quote[1],
            netToBorrower: quote[3],
            residual: quote[4],
            minAcceptable: reviewedMin,
          },
          metadata,
        ),
      };
    }
    case "claim_stream": {
      const streamId = parsed.intent.streamId;
      const [recipient, withdrawable] = await Promise.all([
        read<Address>(client, blockNumber, {
          address: SABLIER_LOCKUP_ADDRESS,
          abi: sablierLockupAbi,
          functionName: "getRecipient",
          args: [streamId],
        }),
        read<bigint>(client, blockNumber, {
          address: SABLIER_LOCKUP_ADDRESS,
          abi: sablierLockupAbi,
          functionName: "withdrawableAmountOf",
          args: [streamId],
        }),
      ]);
      return {
        type: "claim_stream",
        identity,
        market,
        state: readyOutcome({ streamId, recipient, withdrawable }, metadata),
      };
    }
    case "adjust_rate": {
      if (!lending) throw new Error("Lending is not configured");
      const [position, allowance, aprMinBps, aprMaxBps] = await Promise.all([
        positionAt(client, lending, parsed.intent.positionId, blockNumber),
        read<bigint>(client, blockNumber, {
          address: scope.underlying,
          abi: erc20Abi,
          functionName: "allowance",
          args: [identity.account, lending],
        }),
        read<number>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "aprMinBps",
        }),
        read<number>(client, blockNumber, {
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "aprMaxBps",
        }),
      ]);
      return {
        type: "adjust_rate",
        identity,
        market,
        state: readyOutcome(
          { position, allowance, aprMinBps, aprMaxBps },
          metadata,
        ),
      };
    }
    case "repay": {
      if (!lending) throw new Error("Lending is not configured");
      const [loan, walletBalance, allowance] = await Promise.all([
        loanAt(client, lending, parsed.intent.loanId, blockNumber),
        read<bigint>(client, blockNumber, {
          address: scope.ovrfloToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [identity.account],
        }),
        read<bigint>(client, blockNumber, {
          address: scope.ovrfloToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [identity.account, lending],
        }),
      ]);
      return {
        type: "repay",
        identity,
        market,
        state: readyOutcome({ loan, walletBalance, allowance }, metadata),
      };
    }
    case "close": {
      if (!lending) throw new Error("Lending is not configured");
      const loan = await loanAt(client, lending, parsed.intent.loanId, blockNumber);
      const withdrawable = loan
        ? await read<bigint>(client, blockNumber, {
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "withdrawableAmountOf",
            args: [loan.streamId],
          })
        : 0n;
      return {
        type: "close",
        identity,
        market,
        state: readyOutcome({ loan, withdrawable }, metadata),
      };
    }
  }
}

function requestForAction(action: ReadyAction): ExactSimulationRequest {
  const abi =
    action.call.contract === "lending"
      ? ovrfloLendingAbi
      : action.call.contract === "ovrflo"
        ? ovrfloAbi
        : action.call.contract === "sablier"
          ? sablierLockupAbi
          : erc20Abi;
  return {
    address: action.call.target,
    abi,
    functionName: action.call.functionName,
    args: action.call.args,
    ...(action.call.value === 0n ? {} : { value: action.call.value }),
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, child) =>
    typeof child === "bigint" ? `${child}n` : child,
  );
}

function rawCallMatches(raw: LiveWriteArgs, action: ReadyAction): boolean {
  return (
    raw.address !== undefined &&
    isAddressEqual(raw.address, action.call.target) &&
    raw.functionName === action.call.functionName &&
    (raw.value ?? 0n) === action.call.value &&
    stable(raw.args ?? []) === stable(action.call.args)
  );
}

async function buildLiveAction(
  parsed: ParsedAction,
  identity: ActionIdentity,
  scope: LiveMarketScope,
  client: LiveClient,
  options: LiveSnapshotOptions = {},
): Promise<ActionBuildResult> {
  const snapshot = await loadSnapshot(parsed, identity, scope, client, options);
  return buildAction(parsed.intent, snapshot);
}

export async function createLiveActionDraft(
  raw: LiveWriteArgs,
  identity: ActionIdentity,
  scope: LiveMarketScope,
  client: LiveClient,
  options: LiveSnapshotOptions = {},
): Promise<
  | { status: "ready"; draft: ActionExecutionDraft }
  | { status: "invalid"; errors: Extract<ActionBuildResult, { status: "invalid" }>["errors"] }
  | null
> {
  const parsed = parseAction(raw);
  if (!parsed) return null;
  return actionResultToDraft(
    await buildLiveAction(parsed, identity, scope, client, options),
    requestForAction,
  );
}

export async function createLiveExecutionPlan(
  raw: LiveWriteArgs,
  identity: ActionIdentity,
  scope: LiveMarketScope,
  client: LiveClient,
  loadBorrowProjection?: LiveBorrowProjectionLoader,
): Promise<
  | { status: "ready"; plan: ExecutionPlan }
  | { status: "invalid"; errors: Extract<ActionBuildResult, { status: "invalid" }>["errors"] }
  | { status: "needs_review"; draft: ActionExecutionDraft; plan: ExecutionPlan }
  | null
> {
  const initial = await createLiveActionDraft(
    raw,
    identity,
    scope,
    client,
    { loadBorrowProjection },
  );
  if (!initial) return null;
  if (initial.status === "invalid") return initial;
  const accepted = initial.draft;
  const plan: ExecutionPlan = {
    flowId: accepted.action.type,
    accepted,
    rebuild: async (currentIdentity) => {
      const rebuilt = await createLiveActionDraft(
        raw,
        currentIdentity,
        scope,
        client,
        { loadBorrowProjection },
      );
      if (!rebuilt) {
        return {
          status: "invalid",
          errors: [
            {
              code: "action-snapshot-mismatch",
              message: "Action is no longer supported",
            },
          ],
        };
      }
      return rebuilt;
    },
  };
  if (!rawCallMatches(raw, accepted.action)) {
    return { status: "needs_review", draft: accepted, plan };
  }
  return { status: "ready", plan };
}
