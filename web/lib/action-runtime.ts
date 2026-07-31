import { isAddressEqual, type Hash } from "viem";
import { revalidateReview } from "./actions/registry";
import { isUserRejection } from "./errors";
import type {
  ActionBuildResult,
  ActionError,
  ActionIdentity,
  Authorization,
  ReadyAction,
  TouchedResource,
} from "./actions/types";

export type ExactSimulationRequest = Readonly<Record<string, unknown>>;

export type ActionExecutionDraft = {
  action: ReadyAction;
  /**
   * The unsimulated request corresponding to `action.call`. Runtime adapters
   * may carry ABI/runtime-only fields here without teaching pure definitions
   * about wagmi or viem.
   */
  request: ExactSimulationRequest;
};

export type ExecutionPlan = {
  flowId: string;
  accepted: ActionExecutionDraft;
  rebuild: (
    identity: ActionIdentity,
  ) => Promise<
    | { status: "ready"; draft: ActionExecutionDraft }
    | { status: "invalid"; errors: readonly ActionError[] }
  >;
};

export type ExecutionReceipt = {
  transactionHash: Hash;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs?: readonly unknown[];
};

export type ActionExecutionRuntime = {
  getIdentity: () => Promise<ActionIdentity | null>;
  connect?: () => Promise<ActionIdentity>;
  authorize: (
    authorization: Authorization,
    identity: ActionIdentity,
  ) => Promise<ExecutionReceipt>;
  simulate: (
    request: ExactSimulationRequest,
    identity: ActionIdentity,
  ) => Promise<{ request: ExactSimulationRequest }>;
  submit: (request: ExactSimulationRequest) => Promise<Hash>;
  waitForReceipt: (hash: Hash) => Promise<ExecutionReceipt>;
  refresh: (
    resources: readonly TouchedResource[],
    identity: ActionIdentity,
    receipt: ExecutionReceipt,
  ) => Promise<void>;
};

type ReceiptResult = {
  hash: Hash;
  receipt: ExecutionReceipt;
  draft: ActionExecutionDraft;
  identity: ActionIdentity;
};

export type ActionExecutionResult =
  | ({ status: "success" } & ReceiptResult)
  | ({ status: "refresh_failed"; error: unknown } & ReceiptResult)
  | { status: "needs_review"; draft: ActionExecutionDraft }
  | { status: "invalid"; errors: readonly ActionError[] }
  | { status: "identity_changed" }
  | { status: "authorization_failed"; error?: unknown }
  | { status: "simulation_failed"; error: unknown }
  | { status: "rejected"; error: unknown }
  | { status: "transport_failed"; error: unknown }
  | { status: "reverted"; hash: Hash; receipt: ExecutionReceipt };

export type ExecutionPhase =
  | "connecting"
  | "revalidating"
  | "approving"
  | "simulating"
  | "signing"
  | "confirming"
  | "refreshing";

type PhaseListener = (phase: ExecutionPhase) => void;

export function sameActionIdentity(
  left: ActionIdentity,
  right: ActionIdentity | null,
): boolean {
  return (
    right !== null &&
    left.chainId === right.chainId &&
    isAddressEqual(left.account, right.account)
  );
}

async function currentOrConnectedIdentity(
  runtime: ActionExecutionRuntime,
  onPhase?: PhaseListener,
): Promise<ActionIdentity | null> {
  const current = await runtime.getIdentity();
  if (current) return current;
  if (!runtime.connect) return null;
  onPhase?.("connecting");
  return runtime.connect();
}

function materialReviewMatches(
  accepted: ActionExecutionDraft,
  rebuilt: ActionExecutionDraft,
): boolean {
  return revalidateReview(accepted.action.review, rebuilt.action.review).status === "accepted";
}

async function rebuildAccepted(
  plan: ExecutionPlan,
  identity: ActionIdentity,
): Promise<
  | { status: "ready"; draft: ActionExecutionDraft }
  | { status: "invalid"; errors: readonly ActionError[] }
  | { status: "needs_review"; draft: ActionExecutionDraft }
> {
  const rebuilt = await plan.rebuild(identity);
  if (rebuilt.status === "invalid") return rebuilt;
  if (!sameActionIdentity(identity, rebuilt.draft.action.identity)) {
    return {
      status: "invalid",
      errors: [
        {
          code: "action-snapshot-mismatch",
          message: "Rebuilt action does not belong to the latched identity",
        },
      ],
    };
  }
  if (!materialReviewMatches(plan.accepted, rebuilt.draft)) {
    return { status: "needs_review", draft: rebuilt.draft };
  }
  return rebuilt;
}

/**
 * Runs the serial protocol shared by every single action.
 *
 * The request passed to `submit` is the exact object returned by `simulate`.
 * Rebuilds happen before approvals and again after any approval, and identity
 * is checked after every async boundary that can precede a wallet prompt.
 */
export async function runActionExecution(
  plan: ExecutionPlan,
  runtime: ActionExecutionRuntime,
  onPhase?: PhaseListener,
): Promise<ActionExecutionResult> {
  const acceptedIdentity = plan.accepted.action.identity;
  let identity: ActionIdentity | null;
  try {
    identity = await currentOrConnectedIdentity(runtime, onPhase);
  } catch (error) {
    return isUserRejection(error)
      ? { status: "rejected", error }
      : { status: "transport_failed", error };
  }
  if (!sameActionIdentity(acceptedIdentity, identity)) return { status: "identity_changed" };

  onPhase?.("revalidating");
  let rebuilt;
  try {
    rebuilt = await rebuildAccepted(plan, acceptedIdentity);
  } catch (error) {
    return { status: "transport_failed", error };
  }
  if (rebuilt.status !== "ready") return rebuilt;
  let draft = rebuilt.draft;

  const attemptedAuthorizations = new Set<string>();
  while (true) {
    const authorization = draft.action.authorizations.find(
      (candidate) => !candidate.satisfied,
    );
    if (!authorization) break;
    const authorizationKey =
      authorization.kind === "erc20"
        ? `${authorization.kind}:${authorization.token}:${authorization.spender}:${authorization.requiredAmount}:${authorization.approvalAmount}`
        : `${authorization.kind}:${authorization.token}:${authorization.spender}:${authorization.tokenId}`;
    if (attemptedAuthorizations.has(authorizationKey)) {
      return {
        status: "authorization_failed",
        error: new Error("Authorization receipt succeeded but the rebuilt snapshot is still unsatisfied"),
      };
    }
    attemptedAuthorizations.add(authorizationKey);

    let beforeAuthorization: ActionIdentity | null;
    try {
      beforeAuthorization = await runtime.getIdentity();
    } catch (error) {
      return { status: "transport_failed", error };
    }
    if (!sameActionIdentity(acceptedIdentity, beforeAuthorization)) {
      return { status: "identity_changed" };
    }

    onPhase?.("approving");
    let authorizationReceipt: ExecutionReceipt;
    try {
      authorizationReceipt = await runtime.authorize(authorization, acceptedIdentity);
    } catch (error) {
      let afterAuthorizationFailure: ActionIdentity | null;
      try {
        afterAuthorizationFailure = await runtime.getIdentity();
      } catch (identityError) {
        return { status: "transport_failed", error: identityError };
      }
      if (!sameActionIdentity(acceptedIdentity, afterAuthorizationFailure)) {
        return { status: "identity_changed" };
      }
      return isUserRejection(error)
        ? { status: "rejected", error }
        : { status: "authorization_failed", error };
    }
    if (authorizationReceipt.status !== "success") {
      return { status: "authorization_failed" };
    }

    let afterAuthorization: ActionIdentity | null;
    try {
      afterAuthorization = await runtime.getIdentity();
    } catch (error) {
      return { status: "transport_failed", error };
    }
    if (!sameActionIdentity(acceptedIdentity, afterAuthorization)) {
      return { status: "identity_changed" };
    }

    onPhase?.("revalidating");
    try {
      rebuilt = await rebuildAccepted(plan, acceptedIdentity);
    } catch (error) {
      return { status: "transport_failed", error };
    }
    if (rebuilt.status !== "ready") return rebuilt;
    draft = rebuilt.draft;

    let afterRebuild: ActionIdentity | null;
    try {
      afterRebuild = await runtime.getIdentity();
    } catch (error) {
      return { status: "transport_failed", error };
    }
    if (!sameActionIdentity(acceptedIdentity, afterRebuild)) {
      return { status: "identity_changed" };
    }
  }

  onPhase?.("simulating");
  let simulated: { request: ExactSimulationRequest };
  try {
    simulated = await runtime.simulate(draft.request, acceptedIdentity);
  } catch (error) {
    return { status: "simulation_failed", error };
  }

  let beforeSubmit: ActionIdentity | null;
  try {
    beforeSubmit = await runtime.getIdentity();
  } catch (error) {
    return { status: "transport_failed", error };
  }
  if (!sameActionIdentity(acceptedIdentity, beforeSubmit)) {
    return { status: "identity_changed" };
  }

  let hash: Hash;
  onPhase?.("signing");
  try {
    // Do not spread, clone, merge, or reconstruct this object. The simulation
    // result is the signing authority.
    hash = await runtime.submit(simulated.request);
  } catch (error) {
    return isUserRejection(error)
      ? { status: "rejected", error }
      : { status: "transport_failed", error };
  }

  let receipt: ExecutionReceipt;
  onPhase?.("confirming");
  try {
    receipt = await runtime.waitForReceipt(hash);
  } catch (error) {
    return { status: "transport_failed", error };
  }
  if (receipt.status !== "success") return { status: "reverted", hash, receipt };

  onPhase?.("refreshing");
  try {
    await runtime.refresh(draft.action.touchedResources, acceptedIdentity, receipt);
  } catch (error) {
    return {
      status: "refresh_failed",
      hash,
      receipt,
      draft,
      identity: acceptedIdentity,
      error,
    };
  }
  return { status: "success", hash, receipt, draft, identity: acceptedIdentity };
}

export async function retryCriticalRefresh(
  previous: Extract<ActionExecutionResult, { status: "refresh_failed" }>,
  runtime: ActionExecutionRuntime,
): Promise<
  | Extract<ActionExecutionResult, { status: "success" | "refresh_failed" }>
  | { status: "identity_changed" }
> {
  let current: ActionIdentity | null;
  try {
    current = await runtime.getIdentity();
  } catch (error) {
    return { ...previous, error };
  }
  if (!sameActionIdentity(previous.identity, current)) return { status: "identity_changed" };
  try {
    await runtime.refresh(
      previous.draft.action.touchedResources,
      previous.identity,
      previous.receipt,
    );
    return {
      status: "success",
      hash: previous.hash,
      receipt: previous.receipt,
      draft: previous.draft,
      identity: previous.identity,
    };
  } catch (error) {
    return { ...previous, error };
  }
}

export function actionResultToDraft(
  result: ActionBuildResult,
  requestFor: (action: ReadyAction) => ExactSimulationRequest,
):
  | { status: "ready"; draft: ActionExecutionDraft }
  | { status: "invalid"; errors: readonly ActionError[] } {
  return result.status === "ready"
    ? { status: "ready", draft: { action: result.action, request: requestFor(result.action) } }
    : result;
}

export function executionIdentity(plan: ExecutionPlan): string {
  const stable = JSON.stringify(
    {
      flowId: plan.flowId,
      review: plan.accepted.action.review,
    },
    (_key, value) => (typeof value === "bigint" ? `${value}n` : value),
  );
  return `${plan.accepted.action.identity.chainId}:${plan.accepted.action.identity.account.toLowerCase()}:${stable}`;
}
