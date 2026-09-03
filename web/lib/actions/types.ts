import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import type { DisclosureLevel } from "../disclosure";
import { erc20Abi } from "../abis";
import type { ReadOutcome } from "../read-outcome";
import type { ActionType, LiquidityPosition, Loan } from "../types";

export type ActionIdentity = {
  account: Address;
  chainId: number;
};

export type MarketActionContext = {
  vault: Address;
  lending: Address | null;
  market: Address;
  underlying: Address;
  ovrfloToken: Address;
  ptToken: Address;
  sablier: Address;
  expiry: bigint;
  now: bigint;
  reserve: Address;
};

type BaseIntent<T extends ActionType> = { type: T };
type AmountIntent<T extends ActionType> = BaseIntent<T> & { amount: string };

export type SupplyIntent = AmountIntent<"supply"> & { aprBps: number };
export type WithdrawIntent = BaseIntent<"withdraw"> & { positionId: bigint };
export type ClaimShareIntent = BaseIntent<"claim_share"> & { loanId: bigint };
export type ClaimPositionIntent = BaseIntent<"claim_position"> & { positionId: bigint };
export type DepositIntent = AmountIntent<"deposit">;
export type MaturedClaimIntent = AmountIntent<"claim_matured">;
export type WrapIntent = AmountIntent<"wrap">;
export type UnwrapIntent = AmountIntent<"unwrap">;
export type BorrowIntent = AmountIntent<"borrow"> & { streamId: bigint };
export type StreamClaimIntent = BaseIntent<"claim_stream"> & { streamId: bigint };
export type AdjustRateIntent = BaseIntent<"adjust_rate"> & {
  positionId: bigint;
  newAprBps: number;
};
export type RepayIntent = AmountIntent<"repay"> & { loanId: bigint };
export type CloseIntent = BaseIntent<"close"> & { loanId: bigint };
export type HostedConvertIntent = AmountIntent<"hosted_convert"> & {
  inputToken: Address;
  outputToken: Address;
  slippageBps: number;
  enableAggregator: boolean;
};

export type ActionIntent =
  | SupplyIntent
  | WithdrawIntent
  | ClaimShareIntent
  | ClaimPositionIntent
  | DepositIntent
  | MaturedClaimIntent
  | WrapIntent
  | UnwrapIntent
  | BorrowIntent
  | StreamClaimIntent
  | AdjustRateIntent
  | RepayIntent
  | CloseIntent
  | HostedConvertIntent;

type BaseSnapshot<T extends ActionType> = {
  type: T;
  identity: ActionIdentity;
  market: MarketActionContext;
};

type StateSnapshot<T extends ActionType, S> = BaseSnapshot<T> & {
  state: ReadOutcome<S>;
};

export type SupplySnapshot = StateSnapshot<
  "supply",
  {
    walletBalance: bigint;
    allowance: bigint;
    aprMinBps: number;
    aprMaxBps: number;
  }
>;

export type WithdrawSnapshot = StateSnapshot<
  "withdraw",
  { position: LiquidityPosition | null }
>;

export type ClaimShareSnapshot = StateSnapshot<
  "claim_share",
  { loanId: bigint; claimable: bigint }
>;

export type ClaimPair = {
  loanId: bigint;
  claimable: bigint;
};

export type ClaimPositionSnapshot = StateSnapshot<
  "claim_position",
  {
    positionId: bigint;
    pairs: readonly ClaimPair[];
    truncated: boolean;
  }
>;

export type DepositPreview = {
  amount: bigint;
  toWallet: bigint;
  toStream: bigint;
  fee: bigint;
  minToWallet: bigint;
};

export type DepositSnapshot = StateSnapshot<
  "deposit",
  {
    walletBalance: bigint;
    ptAllowance: bigint;
    underlyingAllowance: bigint;
    capLimit: bigint;
    capUsed: bigint;
    preview: DepositPreview;
  }
>;

export type MaturedClaimState = {
  walletBalance: bigint;
  claimablePt: bigint;
  marketTotalDeposited: bigint;
};

export type MaturedClaimSnapshot = StateSnapshot<
  "claim_matured",
  MaturedClaimState
>;

export type WrapSnapshot = StateSnapshot<
  "wrap",
  { walletBalance: bigint; allowance: bigint }
>;

export type UnwrapSnapshot = StateSnapshot<
  "unwrap",
  { walletBalance: bigint; wrapReserve: bigint }
>;

export type BorrowRoutingState = {
  market: Address;
  aprBps: number;
  candidateIds: readonly bigint[];
  aggregateDepth: bigint;
  maxRouteIds: number;
};

export type BorrowHydrationState = {
  positions: readonly LiquidityPosition[];
};

export type { BorrowQuoteSnapshot } from "@/components/borrow/quote";

export type BorrowQuoteState = {
  market: Address;
  streamId: bigint;
  aprBps: number;
  amount: bigint;
  actualBorrow: bigint;
  feeAmount: bigint;
  obligation: bigint;
  residual: bigint;
  minAcceptable: bigint;
};

export type BorrowStreamState = {
  streamId: bigint;
  recipient: Address;
  approved: Address | null;
  approvedForAll: boolean;
  eligible: boolean;
};

export type BorrowSnapshot = BaseSnapshot<"borrow"> & {
  stream: ReadOutcome<BorrowStreamState>;
  routing: ReadOutcome<BorrowRoutingState>;
  hydration: ReadOutcome<BorrowHydrationState>;
  quote: ReadOutcome<BorrowQuoteState>;
};

export type StreamClaimSnapshot = StateSnapshot<
  "claim_stream",
  { streamId: bigint; recipient: Address; withdrawable: bigint }
>;

export type AdjustRateSnapshot = StateSnapshot<
  "adjust_rate",
  {
    position: LiquidityPosition | null;
    allowance: bigint;
    aprMinBps: number;
    aprMaxBps: number;
  }
>;

export type RepaySnapshot = StateSnapshot<
  "repay",
  { loan: Loan | null; walletBalance: bigint; allowance: bigint }
>;

export type CloseSnapshot = StateSnapshot<
  "close",
  { loan: Loan | null; withdrawable: bigint }
>;

export type HostedConvertState = {
  response: unknown;
  now: bigint;
  walletBalance: bigint;
  allowance: bigint;
  disclosure: DisclosureLevel;
};

export type HostedConvertSnapshot = StateSnapshot<"hosted_convert", HostedConvertState>;

export type ActionSnapshot =
  | SupplySnapshot
  | WithdrawSnapshot
  | ClaimShareSnapshot
  | ClaimPositionSnapshot
  | DepositSnapshot
  | MaturedClaimSnapshot
  | WrapSnapshot
  | UnwrapSnapshot
  | BorrowSnapshot
  | StreamClaimSnapshot
  | AdjustRateSnapshot
  | RepaySnapshot
  | CloseSnapshot
  | HostedConvertSnapshot;

export type IntentByType = {
  [T in ActionType]: Extract<ActionIntent, { type: T }>;
};

export type SnapshotByType = {
  [T in ActionType]: Extract<ActionSnapshot, { type: T }>;
};

export type ActionErrorCode =
  | "action-snapshot-mismatch"
  | "snapshot-not-ready"
  | "snapshot-block-mismatch"
  | "snapshot-resource-mismatch"
  | "amount-malformed"
  | "amount-zero"
  | "amount-over-capacity"
  | "wallet-insufficient"
  | "market-not-configured"
  | "market-matured"
  | "market-not-matured"
  | "invalid-apr"
  | "same-rate"
  | "position-not-found"
  | "not-owner"
  | "nothing-claimable"
  | "claim-pairs-empty"
  | "stream-not-owned"
  | "stream-ineligible"
  | "loan-not-found"
  | "loan-closed"
  | "loan-not-closable"
  | "routing-incomplete"
  | "routing-insufficient"
  | "quote-invalid"
  | "unregistered-target"
  | "hosted-unavailable"
  | "hosted-chain-mismatch"
  | "hosted-token-mismatch"
  | "hosted-router-mismatch"
  | "hosted-semantics"
  | "hosted-bounds"
  | "hosted-deadline"
  | "hosted-impact"
  | "hosted-response";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
};

export type Erc20Authorization = {
  kind: "erc20";
  token: Address;
  spender: Address;
  requiredAmount: bigint;
  approvalAmount: bigint;
  currentAllowance: bigint;
  satisfied: boolean;
  strategy: "optimistic-zero-first";
};

export type Erc721Authorization = {
  kind: "erc721";
  token: Address;
  spender: Address;
  tokenId: bigint;
  satisfied: boolean;
};

export type Authorization = Erc20Authorization | Erc721Authorization;

export type ContractKind = "erc20" | "ovrflo" | "lending" | "sablier" | "reserve" | "pendle_router";

export type FinalCall = {
  target: Address;
  contract: ContractKind;
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  calls?: readonly FinalCall[];
  data?: Hex;
};

export type TouchedResource =
  /**
   * Compatibility tag for an already-scoped legacy call site. New action
   * definitions should prefer the domain-specific variants below.
   */
  | { kind: "contract"; address: Address }
  | { kind: "market"; vault: Address; market: Address }
  | { kind: "market-depth"; lending: Address; market: Address; aprBps?: number }
  | { kind: "liquidity-position"; lending: Address; id: bigint }
  | { kind: "loan"; lending: Address; id: bigint }
  | { kind: "stream"; sablier: Address; id?: bigint }
  | {
      kind: "nft-approval";
      token: Address;
      owner: Address;
      spender: Address;
      tokenId: bigint;
    }
  | { kind: "token-balance"; token: Address; account: Address }
  | { kind: "allowance"; token: Address; owner: Address; spender: Address };

export type FrozenRoute = {
  ids: readonly bigint[];
  amounts: readonly bigint[];
  aprBps: number;
};

export type FrozenReview = {
  actionType: ActionType;
  title: string;
  identity: ActionIdentity;
  call: FinalCall;
  authorizations: readonly Authorization[];
  route?: FrozenRoute;
  economics: Readonly<Record<string, bigint | number | string | boolean>>;
};

export type ReceiptSummaryData = {
  source: Address;
  eventName: string | null;
  label: string;
  expectedIds: readonly bigint[];
  expectedAmounts: Readonly<Record<string, bigint>>;
};

export type ReadyAction = {
  type: ActionType;
  identity: ActionIdentity;
  preconditions: readonly string[];
  authorizations: readonly Authorization[];
  call: FinalCall;
  touchedResources: readonly TouchedResource[];
  review: FrozenReview;
  receiptSummary: ReceiptSummaryData;
};

export type ActionBuildResult =
  | { status: "ready"; action: ReadyAction }
  | { status: "invalid"; errors: readonly ActionError[] };

export type ActionDefinition<T extends ActionType> = {
  type: T;
  build: (
    intent: IntentByType[T],
    snapshot: SnapshotByType[T],
  ) => ActionBuildResult;
};

export type ActionRegistry = {
  [T in ActionType]: ActionDefinition<T>;
};

export function actionError(code: ActionErrorCode, message: string): ActionError {
  return { code, message };
}

export function invalidAction(...errors: ActionError[]): ActionBuildResult {
  return { status: "invalid", errors };
}

export function parsePositiveAmount(
  raw: string,
): { ok: true; amount: bigint } | { ok: false; error: ActionError } {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) {
    return {
      ok: false,
      error: actionError("amount-malformed", "Enter a base-10 amount with at most 18 decimals"),
    };
  }
  const amount = parseUnits(value, 18);
  if (amount <= 0n) {
    return {
      ok: false,
      error: actionError("amount-zero", "Amount must be greater than zero"),
    };
  }
  return { ok: true, amount };
}

export function erc20Authorization({
  token,
  spender,
  amount,
  approvalAmount = amount,
  currentAllowance,
}: {
  token: Address;
  spender: Address;
  amount: bigint;
  approvalAmount?: bigint;
  currentAllowance: bigint;
}): Erc20Authorization {
  return {
    kind: "erc20",
    token,
    spender,
    requiredAmount: amount,
    approvalAmount,
    currentAllowance,
    satisfied: currentAllowance >= amount,
    strategy: "optimistic-zero-first",
  };
}

export function readyAction({
  type,
  identity,
  title,
  preconditions,
  authorizations,
  call,
  touchedResources,
  route,
  economics,
  receiptSummary,
}: {
  type: ActionType;
  identity: ActionIdentity;
  title: string;
  preconditions: readonly string[];
  authorizations: readonly Authorization[];
  call: FinalCall;
  touchedResources: readonly TouchedResource[];
  route?: FrozenRoute;
  economics: Readonly<Record<string, bigint | number | string | boolean>>;
  receiptSummary: ReceiptSummaryData;
}): ActionBuildResult {
  const review: FrozenReview = {
    actionType: type,
    title,
    identity,
    call,
    authorizations,
    ...(route ? { route } : {}),
    economics,
  };
  return {
    status: "ready",
    action: {
      type,
      identity,
      preconditions,
      authorizations,
      call,
      touchedResources,
      review,
      receiptSummary,
    },
  };
}

/** See-equals-sign: PERMISSION RECEIPT amount is this exact approve calldata. */
export function permissionCalldata(authorization: Erc20Authorization): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [authorization.spender, authorization.approvalAmount],
  });
}
