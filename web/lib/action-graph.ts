import type { Address } from "viem";
import type { QueuedTx } from "./claim-all";
export const GRAPH_STEP_CLEAR_TO_ZERO = "auth-clear-to-zero";
export const GRAPH_STEP_SET_ALLOWANCE = "auth-set-allowance";
export const GRAPH_STEP_SET_APPROVAL = "auth-set-approval";
export const GRAPH_STEP_DEPOSIT = "deposit";
export const GRAPH_STEP_BORROW = "borrow";
export const GRAPH_STEP_POST = "post-request";
export const GRAPH_STEP_SUPPLY = "supply";

export type GraphSemanticId =
  | typeof GRAPH_STEP_CLEAR_TO_ZERO
  | typeof GRAPH_STEP_SET_ALLOWANCE
  | typeof GRAPH_STEP_SET_APPROVAL
  | typeof GRAPH_STEP_DEPOSIT
  | typeof GRAPH_STEP_BORROW
  | typeof GRAPH_STEP_POST
  | typeof GRAPH_STEP_SUPPLY;

export type GraphKind = "deposit-plus-borrow" | "borrow" | "supply";

export type EconomicIdentity = {
  kind: GraphSemanticId;
  chainId: number;
  token: string;
  amount: string;
};

export type ActionGraphStep = {
  stepId: GraphSemanticId;
  semanticId: GraphSemanticId;
  dependsOn: readonly GraphSemanticId[];
  economicIdentity: EconomicIdentity;
};

export type ActionGraph = {
  graphId: string;
  kind: GraphKind;
  chainId: number;
  steps: readonly ActionGraphStep[];
};

export type AllowanceSnapshot = {
  token: Address | string;
  spender: Address | string;
  current: bigint;
  required: bigint;
};

export type NftApprovalSnapshot = {
  token: Address | string;
  spender: Address | string;
  tokenId: string;
  needed: boolean;
};

export type CompileActionGraphInput = {
  graphId: string;
  chainId: number;
  kind: GraphKind;
  token: Address | string;
  amount: string;
  allowance: AllowanceSnapshot | null;
  nftApproval?: NftApprovalSnapshot;
  borrowExecutable: boolean;
  cs3Available: boolean;
};

export type CompileActionGraphResult =
  | { status: "ready"; graph: ActionGraph }
  | { status: "blocked"; reason: "no-liquidity-without-cs3" };

function identity(
  kind: GraphSemanticId,
  chainId: number,
  token: Address | string,
  amount: string,
): EconomicIdentity {
  return {
    kind,
    chainId,
    token: token.toLowerCase(),
    amount,
  };
}

function step(
  semanticId: GraphSemanticId,
  dependsOn: readonly GraphSemanticId[],
  economicIdentity: EconomicIdentity,
): ActionGraphStep {
  return { stepId: semanticId, semanticId, dependsOn, economicIdentity };
}

function authorizationSteps(
  chainId: number,
  allowance: AllowanceSnapshot | null,
): ActionGraphStep[] {
  if (!allowance || allowance.required <= 0n) return [];
  const token = allowance.token.toLowerCase();
  const steps: ActionGraphStep[] = [];
  if (allowance.current > 0n && allowance.current < allowance.required) {
    steps.push(
      step(GRAPH_STEP_CLEAR_TO_ZERO, [], identity(GRAPH_STEP_CLEAR_TO_ZERO, chainId, token, "0")),
    );
  }
  if (allowance.current < allowance.required) {
    const dependsOn: GraphSemanticId[] = steps.length > 0 ? [GRAPH_STEP_CLEAR_TO_ZERO] : [];
    steps.push(
      step(
        GRAPH_STEP_SET_ALLOWANCE,
        dependsOn,
        identity(GRAPH_STEP_SET_ALLOWANCE, chainId, token, allowance.required.toString()),
      ),
    );
  }
  return steps;
}

function lastId(steps: readonly ActionGraphStep[]): GraphSemanticId[] {
  const last = steps[steps.length - 1];
  return last ? [last.stepId] : [];
}

/**
 * Compile one mode-neutral graph. Deposit-plus-borrow without executable
 * borrow and without CS3 is blocked before any step is produced.
 */
export function compileActionGraph(input: CompileActionGraphInput): CompileActionGraphResult {
  if (input.kind === "deposit-plus-borrow" && !input.borrowExecutable && !input.cs3Available) {
    return { status: "blocked", reason: "no-liquidity-without-cs3" };
  }

  const token = input.token.toLowerCase();
  const auth = authorizationSteps(input.chainId, input.allowance);
  const steps: ActionGraphStep[] = [...auth];

  if (input.kind === "deposit-plus-borrow") {
    steps.push(
      step(
        GRAPH_STEP_DEPOSIT,
        lastId(steps),
        identity(GRAPH_STEP_DEPOSIT, input.chainId, token, input.amount),
      ),
    );
    if (input.nftApproval?.needed) {
      steps.push(
        step(
          GRAPH_STEP_SET_APPROVAL,
          lastId(steps),
          identity(GRAPH_STEP_SET_APPROVAL, input.chainId, input.nftApproval.token, input.nftApproval.tokenId),
        ),
      );
    }
    steps.push(
      step(
        input.borrowExecutable ? GRAPH_STEP_BORROW : GRAPH_STEP_POST,
        lastId(steps),
        identity(
          input.borrowExecutable ? GRAPH_STEP_BORROW : GRAPH_STEP_POST,
          input.chainId,
          token,
          input.amount,
        ),
      ),
    );
  } else if (input.kind === "borrow") {
    if (input.nftApproval?.needed) {
      steps.push(
        step(
          GRAPH_STEP_SET_APPROVAL,
          lastId(steps),
          identity(GRAPH_STEP_SET_APPROVAL, input.chainId, input.nftApproval.token, input.nftApproval.tokenId),
        ),
      );
    }
    steps.push(
      step(
        input.borrowExecutable || !input.cs3Available ? GRAPH_STEP_BORROW : GRAPH_STEP_POST,
        lastId(steps),
        identity(
          input.borrowExecutable || !input.cs3Available ? GRAPH_STEP_BORROW : GRAPH_STEP_POST,
          input.chainId,
          token,
          input.amount,
        ),
      ),
    );
  } else {
    steps.push(
      step(
        GRAPH_STEP_SUPPLY,
        lastId(steps),
        identity(GRAPH_STEP_SUPPLY, input.chainId, token, input.amount),
      ),
    );
  }

  return {
    status: "ready",
    graph: {
      graphId: input.graphId,
      kind: input.kind,
      chainId: input.chainId,
      steps,
    },
  };
}

export function economicIdentityKey(identity: EconomicIdentity): string {
  return `${identity.kind}:${identity.chainId}:${identity.token}:${identity.amount}`;
}

export function sameEconomicIdentity(left: EconomicIdentity, right: EconomicIdentity): boolean {
  return economicIdentityKey(left) === economicIdentityKey(right);
}

export function sameStepEconomics(
  stored: readonly ActionGraphStep[] | undefined,
  requested: readonly ActionGraphStep[],
): boolean {
  if (!stored || stored.length !== requested.length) return false;
  return stored.every((step, index) => {
    const next = requested[index];
    return (
      next !== undefined &&
      step.stepId === next.stepId &&
      sameEconomicIdentity(step.economicIdentity, next.economicIdentity)
    );
  });
}

export function withGraphId(graph: ActionGraph, graphId: string): ActionGraph {
  return graph.graphId === graphId ? graph : { ...graph, graphId };
}

/** Immediate total is shown only when deposit mint and borrow are both executable. */
export function immediateTotal(args: {
  depositNet: bigint | null;
  borrowNet: bigint | null;
  borrowExecutable: boolean;
}): bigint | null {
  if (!args.borrowExecutable) return null;
  if (args.depositNet === null || args.borrowNet === null) return null;
  return args.depositNet + args.borrowNet;
}

export function graphToQueuedTx(graph: ActionGraph): Extract<QueuedTx, { kind: "graph-step" }>[] {
  return graph.steps.map((step) => ({
    kind: "graph-step" as const,
    stepId: step.stepId,
    semanticId: step.semanticId,
    economicIdentity: step.economicIdentity,
  }));
}
