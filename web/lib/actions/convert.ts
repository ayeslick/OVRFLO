import { isFreshReady } from "../read-outcome";
import { bufferedFeeApproveAmount, depositCapStatus } from "../convert";
import {
  actionError,
  erc20Authorization,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
} from "./types";

export const depositDefinition: ActionDefinition<"deposit"> = {
  type: "deposit",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Deposit state is not fresh and complete"));
    }
    if (snapshot.market.now >= snapshot.market.expiry) {
      return invalidAction(actionError("market-matured", "Deposits close at maturity"));
    }
    const state = snapshot.state.data;
    const { capRemaining, capReached, capExceeded } = depositCapStatus({
      mode: "deposit",
      amount: parsed.amount,
      capLoaded: true,
      capLimit: state.capLimit,
      capUsed: state.capUsed,
    });
    if (parsed.amount > state.walletBalance) {
      return invalidAction(actionError("wallet-insufficient", "Amount exceeds PT wallet balance"));
    }
    if (capReached || capExceeded) {
      return invalidAction(actionError("amount-over-capacity", "Amount exceeds the fresh deposit capacity"));
    }
    if (
      state.preview.amount !== parsed.amount ||
      state.preview.toWallet < 0n ||
      state.preview.toStream < 0n ||
      state.preview.fee < 0n ||
      state.preview.minToWallet < 0n ||
      state.preview.minToWallet > state.preview.toWallet
    ) {
      return invalidAction(actionError("quote-invalid", "Deposit preview contains an invalid amount"));
    }
    const authorizations = [
      erc20Authorization({
        token: snapshot.market.ptToken,
        spender: snapshot.market.vault,
        amount: parsed.amount,
        currentAllowance: state.ptAllowance,
      }),
      ...(state.preview.fee > 0n
        ? [
            erc20Authorization({
              token: snapshot.market.underlying,
              spender: snapshot.market.vault,
              amount: state.preview.fee,
              approvalAmount: bufferedFeeApproveAmount(state.preview.fee),
              currentAllowance: state.underlyingAllowance,
            }),
          ]
        : []),
    ];
    const call = {
      target: snapshot.market.vault,
      contract: "ovrflo" as const,
      functionName: "deposit",
      args: [snapshot.market.market, parsed.amount, state.preview.minToWallet] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "DEPOSIT PT",
      preconditions: ["fresh-state", "market-live", "amount-valid", "capacity-valid", "preview-valid"],
      authorizations,
      call,
      touchedResources: [
        { kind: "market", vault: snapshot.market.vault, market: snapshot.market.market },
        { kind: "token-balance", token: snapshot.market.ptToken, account: snapshot.identity.account },
        { kind: "token-balance", token: snapshot.market.underlying, account: snapshot.identity.account },
        { kind: "token-balance", token: snapshot.market.ovrfloToken, account: snapshot.identity.account },
        {
          kind: "allowance",
          token: snapshot.market.ptToken,
          owner: snapshot.identity.account,
          spender: snapshot.market.vault,
        },
        ...(state.preview.fee > 0n
          ? [
              {
                kind: "allowance" as const,
                token: snapshot.market.underlying,
                owner: snapshot.identity.account,
                spender: snapshot.market.vault,
              },
            ]
          : []),
      ],
      economics: {
        amount: parsed.amount,
        toWallet: state.preview.toWallet,
        toStream: state.preview.toStream,
        fee: state.preview.fee,
        minToWallet: state.preview.minToWallet,
        capRemaining: capRemaining ?? "unlimited",
      },
      receiptSummary: {
        source: snapshot.market.vault,
        eventName: "Deposited",
        label: "DEPOSITED",
        expectedIds: [],
        expectedAmounts: {
          deposited: parsed.amount,
          minimumToWallet: state.preview.minToWallet,
          fee: state.preview.fee,
        },
      },
    });
  },
};

export const wrapDefinition: ActionDefinition<"wrap"> = {
  type: "wrap",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Wrap state is not fresh and complete"));
    }
    const state = snapshot.state.data;
    if (parsed.amount > state.walletBalance) {
      return invalidAction(actionError("wallet-insufficient", "Amount exceeds underlying wallet balance"));
    }
    const authorizations = [
      erc20Authorization({
        token: snapshot.market.underlying,
        spender: snapshot.market.vault,
        amount: parsed.amount,
        currentAllowance: state.allowance,
      }),
    ];
    const call = {
      target: snapshot.market.vault,
      contract: "ovrflo" as const,
      functionName: "wrap",
      args: [parsed.amount] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "WRAP",
      preconditions: ["fresh-state", "amount-valid"],
      authorizations,
      call,
      touchedResources: [
        { kind: "market", vault: snapshot.market.vault, market: snapshot.market.market },
        { kind: "token-balance", token: snapshot.market.underlying, account: snapshot.identity.account },
        { kind: "token-balance", token: snapshot.market.ovrfloToken, account: snapshot.identity.account },
        {
          kind: "allowance",
          token: snapshot.market.underlying,
          owner: snapshot.identity.account,
          spender: snapshot.market.vault,
        },
      ],
      economics: { amount: parsed.amount },
      receiptSummary: {
        source: snapshot.market.vault,
        eventName: "Wrapped",
        label: "WRAPPED",
        expectedIds: [],
        expectedAmounts: { wrapped: parsed.amount },
      },
    });
  },
};

export const unwrapDefinition: ActionDefinition<"unwrap"> = {
  type: "unwrap",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Unwrap state is not fresh and complete"));
    }
    const state = snapshot.state.data;
    const capacity = state.walletBalance < state.wrapReserve ? state.walletBalance : state.wrapReserve;
    if (parsed.amount > capacity) {
      return invalidAction(actionError("amount-over-capacity", "Amount exceeds fresh unwrap capacity"));
    }
    const call = {
      target: snapshot.market.vault,
      contract: "ovrflo" as const,
      functionName: "unwrap",
      args: [parsed.amount] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "UNWRAP",
      preconditions: ["fresh-state", "amount-valid", "reserve-valid"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "market", vault: snapshot.market.vault, market: snapshot.market.market },
        { kind: "token-balance", token: snapshot.market.underlying, account: snapshot.identity.account },
        { kind: "token-balance", token: snapshot.market.ovrfloToken, account: snapshot.identity.account },
      ],
      economics: { amount: parsed.amount, capacity },
      receiptSummary: {
        source: snapshot.market.vault,
        eventName: "Unwrapped",
        label: "UNWRAPPED",
        expectedIds: [],
        expectedAmounts: { unwrapped: parsed.amount },
      },
    });
  },
};
