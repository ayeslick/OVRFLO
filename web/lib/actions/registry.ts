import { borrowDefinition } from "./borrow";
import { claimPositionDefinition, maturedClaimDefinition, streamClaimDefinition } from "./claim";
import { depositDefinition, unwrapDefinition, wrapDefinition } from "./convert";
import { adjustRateDefinition, closeDefinition } from "./positions";
import { repayDefinition } from "./repay";
import { claimShareDefinition, supplyDefinition, withdrawDefinition } from "./supply";
import {
  actionError,
  invalidAction,
  type ActionBuildResult,
  type ActionIntent,
  type ActionRegistry,
  type ActionSnapshot,
  type Authorization,
  type FrozenReview,
} from "./types";

export const ACTION_TYPES = [
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
] as const;

export const actionRegistry = {
  supply: supplyDefinition,
  withdraw: withdrawDefinition,
  claim_share: claimShareDefinition,
  claim_position: claimPositionDefinition,
  deposit: depositDefinition,
  claim_matured: maturedClaimDefinition,
  wrap: wrapDefinition,
  unwrap: unwrapDefinition,
  borrow: borrowDefinition,
  claim_stream: streamClaimDefinition,
  adjust_rate: adjustRateDefinition,
  repay: repayDefinition,
  close: closeDefinition,
} satisfies ActionRegistry;

export function buildAction(
  intent: ActionIntent,
  snapshot: ActionSnapshot,
): ActionBuildResult {
  if (intent.type !== snapshot.type) {
    return invalidAction(
      actionError("action-snapshot-mismatch", "Intent and snapshot action types do not match"),
    );
  }
  const build = actionRegistry[intent.type].build as unknown as (
    currentIntent: ActionIntent,
    currentSnapshot: ActionSnapshot,
  ) => ActionBuildResult;
  return build(intent, snapshot);
}

function materialAuthorization(authorization: Authorization) {
  if (authorization.kind === "erc20") {
    return {
      kind: authorization.kind,
      token: authorization.token,
      spender: authorization.spender,
      requiredAmount: authorization.requiredAmount,
      approvalAmount: authorization.approvalAmount,
      strategy: authorization.strategy,
    };
  }
  return {
    kind: authorization.kind,
    token: authorization.token,
    spender: authorization.spender,
    tokenId: authorization.tokenId,
  };
}

function materialReview(review: FrozenReview) {
  return {
    actionType: review.actionType,
    title: review.title,
    identity: review.identity,
    call: review.call,
    authorizations: review.authorizations.map(materialAuthorization),
    route: review.route,
    economics: review.economics,
  };
}

function stableValue(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function revalidateReview(
  accepted: FrozenReview,
  rebuilt: FrozenReview,
): { status: "accepted" } | { status: "needs-review"; review: FrozenReview } {
  const unchanged =
    JSON.stringify(stableValue(materialReview(accepted))) ===
    JSON.stringify(stableValue(materialReview(rebuilt)));
  return unchanged ? { status: "accepted" } : { status: "needs-review", review: rebuilt };
}
