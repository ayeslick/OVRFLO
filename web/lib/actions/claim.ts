import { encodeFunctionData, isAddressEqual } from "viem";
import { ovrfloLendingAbi } from "../abis";
import { isFreshReady } from "../read-outcome";
import { MAX_UINT128 } from "../lending-math";
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

/**
 * ponytail: 32-pair Multicall ceiling. `test/OVRFLOLendingGas.t.sol` measures
 * borrow flatness, not per-pair claim gas, and this session did not run a live
 * fork claim measurement. Bound: a harvest claim is two externals (Sablier
 * `withdraw` + ERC-20 transfer). 32 × ~250k ≈ 8M gas, under 25% of a 36M
 * mainnet block with Multicall overhead. Overflow is a second "claim remaining"
 * transaction, not one oversized batch (plan risk 7).
 */
export const CLAIM_PAIRS_PER_TX = 32;

export const claimPositionDefinition: ActionDefinition<"claim_position"> = {
  type: "claim_position",
  build(intent, snapshot) {
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Position claim state is not fresh and complete"),
      );
    }
    const state = snapshot.state.data;
    if (state.positionId !== intent.positionId) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Claim pairs do not match the selected position"),
      );
    }
    const claimable = state.pairs.filter((pair) => pair.claimable > 0n);
    if (claimable.length === 0) {
      return invalidAction(actionError("nothing-claimable", "No loan pairs are currently claimable"));
    }
    const batch = claimable.slice(0, CLAIM_PAIRS_PER_TX);
    const calls = batch.map((pair) => ({
      target: lending,
      contract: "lending" as const,
      functionName: "claim" as const,
      args: [pair.loanId, intent.positionId, MAX_UINT128] as const,
      value: 0n,
    }));
    const encoded = calls.map((nested) =>
      encodeFunctionData({
        abi: ovrfloLendingAbi,
        functionName: "claim",
        args: [nested.args[0], nested.args[1], nested.args[2]],
      }),
    );
    const call =
      batch.length === 1
        ? {
            target: lending,
            contract: "lending" as const,
            functionName: "claim" as const,
            args: [batch[0]!.loanId, intent.positionId, MAX_UINT128] as const,
            value: 0n,
          }
        : {
            target: lending,
            contract: "lending" as const,
            functionName: "multicall" as const,
            args: [encoded] as const,
            value: 0n,
            calls,
          };
    const claimableTotal = batch.reduce((sum, pair) => sum + pair.claimable, 0n);
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CLAIM",
      preconditions: ["fresh-pairs", "positive-claimable", "pair-cap"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "liquidity-position", lending, id: intent.positionId },
        ...batch.map((pair) => ({ kind: "loan" as const, lending, id: pair.loanId })),
        {
          kind: "token-balance",
          token: snapshot.market.ovrfloToken,
          account: snapshot.identity.account,
        },
      ],
      economics: {
        positionId: intent.positionId,
        pairCount: batch.length,
        truncated: state.truncated || claimable.length > CLAIM_PAIRS_PER_TX,
        claimable: claimableTotal,
      },
      receiptSummary: {
        source: lending,
        eventName: "Claimed",
        label: "CLAIMED",
        expectedIds: [intent.positionId, ...batch.map((pair) => pair.loanId)],
        expectedAmounts: { claimable: claimableTotal },
      },
    });
  },
};
