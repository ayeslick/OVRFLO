import { isAddressEqual } from "viem";
import { isFreshReady } from "../read-outcome";
import {
  actionError,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
  type MaturedClaimSnapshot,
  type MaturedClaimState,
} from "./types";

export function maturedClaimCapacity(state: MaturedClaimState): bigint {
  let capacity = state.walletBalance;
  if (state.claimablePt < capacity) capacity = state.claimablePt;
  if (state.marketTotalDeposited < capacity) capacity = state.marketTotalDeposited;
  return capacity;
}

export function maturedClaimMax(snapshot: MaturedClaimSnapshot): bigint | null {
  if (!isFreshReady(snapshot.state) || snapshot.market.now < snapshot.market.expiry) {
    return null;
  }
  return maturedClaimCapacity(snapshot.state.data);
}

export const maturedClaimDefinition: ActionDefinition<"claim_matured"> = {
  type: "claim_matured",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Claim state is not fresh and complete"));
    }
    if (snapshot.market.now < snapshot.market.expiry) {
      return invalidAction(actionError("market-not-matured", "PT claims open at maturity"));
    }
    const capacity = maturedClaimCapacity(snapshot.state.data);
    if (parsed.amount > capacity) {
      return invalidAction(
        actionError("amount-over-capacity", "Amount exceeds the fresh matured-claim capacity"),
      );
    }
    const call = {
      target: snapshot.market.vault,
      contract: "ovrflo" as const,
      functionName: "claim",
      args: [snapshot.market.ptToken, parsed.amount] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CLAIM MATURED PT",
      preconditions: ["fresh-state", "market-matured", "amount-valid", "capacity-valid"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "market", vault: snapshot.market.vault, market: snapshot.market.market },
        { kind: "token-balance", token: snapshot.market.ptToken, account: snapshot.identity.account },
        {
          kind: "token-balance",
          token: snapshot.market.underlying,
          account: snapshot.identity.account,
        },
      ],
      economics: { amount: parsed.amount, capacity },
      receiptSummary: {
        source: snapshot.market.vault,
        eventName: "Claimed",
        label: "CLAIMED",
        expectedIds: [],
        expectedAmounts: { claimed: parsed.amount },
      },
    });
  },
};

export const streamClaimDefinition: ActionDefinition<"claim_stream"> = {
  type: "claim_stream",
  build(intent, snapshot) {
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Stream claim state is not fresh and complete"),
      );
    }
    const state = snapshot.state.data;
    if (state.streamId !== intent.streamId) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Stream state does not match the claim intent"),
      );
    }
    if (!isAddressEqual(state.recipient, snapshot.identity.account)) {
      return invalidAction(
        actionError("stream-not-owned", "Connected account is not the stream recipient"),
      );
    }
    if (state.withdrawable <= 0n) {
      return invalidAction(actionError("nothing-claimable", "No stream balance is withdrawable"));
    }
    const call = {
      target: snapshot.market.sablier,
      contract: "sablier" as const,
      functionName: "withdrawMax",
      args: [intent.streamId, snapshot.identity.account] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CLAIM STREAM",
      preconditions: ["fresh-stream", "stream-owned", "positive-withdrawable"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "stream", sablier: snapshot.market.sablier, id: intent.streamId },
        {
          kind: "token-balance",
          token: snapshot.market.underlying,
          account: snapshot.identity.account,
        },
      ],
      economics: { streamId: intent.streamId, withdrawable: state.withdrawable },
      receiptSummary: {
        source: snapshot.market.sablier,
        eventName: "WithdrawFromLockupStream",
        label: "CLAIMED",
        expectedIds: [intent.streamId],
        expectedAmounts: { withdrawable: state.withdrawable },
      },
    });
  },
};
