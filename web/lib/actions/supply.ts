import { isAddressEqual } from "viem";
import { APR_STEP_BPS, MAX_UINT128 } from "../lending-math";
import { isFreshReady } from "../read-outcome";
import {
  actionError,
  erc20Authorization,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
  type ClaimShareSnapshot,
  type SupplySnapshot,
  type WithdrawSnapshot,
} from "./types";

function lendingRequired(
  snapshot: SupplySnapshot | WithdrawSnapshot | ClaimShareSnapshot,
) {
  return snapshot.market.lending;
}

export const supplyDefinition: ActionDefinition<"supply"> = {
  type: "supply",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    const lending = lendingRequired(snapshot);
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Supply state is not fresh and complete"));
    }
    if (snapshot.market.now >= snapshot.market.expiry) {
      return invalidAction(actionError("market-matured", "Supply closes at maturity"));
    }
    const state = snapshot.state.data;
    if (
      !Number.isSafeInteger(intent.aprBps) ||
      intent.aprBps < state.aprMinBps ||
      intent.aprBps > state.aprMaxBps ||
      intent.aprBps % APR_STEP_BPS !== 0
    ) {
      return invalidAction(actionError("invalid-apr", "APR is outside the current posting bounds"));
    }
    if (parsed.amount > state.walletBalance) {
      return invalidAction(actionError("wallet-insufficient", "Amount exceeds wallet balance"));
    }
    const authorizations = [
      erc20Authorization({
        token: snapshot.market.underlying,
        spender: lending,
        amount: parsed.amount,
        currentAllowance: state.allowance,
      }),
    ];
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "supply",
      args: [snapshot.market.market, intent.aprBps, parsed.amount] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "SUPPLY LIQUIDITY",
      preconditions: ["fresh-state", "market-live", "apr-postable", "amount-valid"],
      authorizations,
      call,
      touchedResources: [
        { kind: "market-depth", lending, market: snapshot.market.market, aprBps: intent.aprBps },
        { kind: "token-balance", token: snapshot.market.underlying, account: snapshot.identity.account },
        {
          kind: "allowance",
          token: snapshot.market.underlying,
          owner: snapshot.identity.account,
          spender: lending,
        },
      ],
      economics: { amount: parsed.amount, aprBps: intent.aprBps },
      receiptSummary: {
        source: lending,
        eventName: "Supplied",
        label: "SUPPLIED",
        expectedIds: [],
        expectedAmounts: { supplied: parsed.amount },
      },
    });
  },
};

export const withdrawDefinition: ActionDefinition<"withdraw"> = {
  type: "withdraw",
  build(intent, snapshot) {
    const lending = lendingRequired(snapshot);
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Position state is not fresh and complete"));
    }
    const position = snapshot.state.data.position;
    if (!position || position.id !== intent.positionId || position.availableLiquidity <= 0n) {
      return invalidAction(actionError("position-not-found", "Liquidity position is not withdrawable"));
    }
    if (!isAddressEqual(position.lender, snapshot.identity.account)) {
      return invalidAction(actionError("not-owner", "Connected account does not own this position"));
    }
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "withdraw",
      args: [intent.positionId] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "WITHDRAW LIQUIDITY",
      preconditions: ["fresh-position", "position-owned", "position-active"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "liquidity-position", lending, id: intent.positionId },
        { kind: "market-depth", lending, market: position.market, aprBps: position.aprBps },
        { kind: "token-balance", token: snapshot.market.underlying, account: snapshot.identity.account },
      ],
      economics: { positionId: intent.positionId, amount: position.availableLiquidity },
      receiptSummary: {
        source: lending,
        eventName: "Withdrawn",
        label: "WITHDRAWN",
        expectedIds: [intent.positionId],
        expectedAmounts: { requested: position.availableLiquidity },
      },
    });
  },
};

export const claimShareDefinition: ActionDefinition<"claim_share"> = {
  type: "claim_share",
  build(intent, snapshot) {
    const lending = lendingRequired(snapshot);
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Pool claim state is not fresh and complete"));
    }
    const state = snapshot.state.data;
    if (state.loanId !== intent.loanId || state.claimable <= 0n) {
      return invalidAction(actionError("nothing-claimable", "No pool share is currently claimable"));
    }
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "claim",
      args: [intent.loanId, 0n, MAX_UINT128] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CLAIM SHARE",
      preconditions: ["fresh-claim", "positive-claimable"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "loan", lending, id: intent.loanId },
        { kind: "token-balance", token: snapshot.market.ovrfloToken, account: snapshot.identity.account },
      ],
      economics: { loanId: intent.loanId, claimable: state.claimable },
      receiptSummary: {
        source: lending,
        eventName: "Claimed",
        label: "CLAIMED",
        expectedIds: [intent.loanId],
        expectedAmounts: { claimable: state.claimable },
      },
    });
  },
};
