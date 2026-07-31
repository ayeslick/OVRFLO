import { encodeFunctionData, isAddressEqual } from "viem";
import { ovrfloLendingAbi } from "../abis";
import { APR_STEP_BPS, isLoanOpen, loanOutstanding } from "../lending-math";
import { isFreshReady } from "../read-outcome";
import {
  actionError,
  erc20Authorization,
  invalidAction,
  readyAction,
  type ActionDefinition,
} from "./types";

export const adjustRateDefinition: ActionDefinition<"adjust_rate"> = {
  type: "adjust_rate",
  build(intent, snapshot) {
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(
        actionError("snapshot-not-ready", "Position state is not fresh and complete"),
      );
    }
    if (snapshot.market.now >= snapshot.market.expiry) {
      return invalidAction(actionError("market-matured", "Rate changes close at maturity"));
    }
    const state = snapshot.state.data;
    const position = state.position;
    if (!position || position.id !== intent.positionId || position.availableLiquidity <= 0n) {
      return invalidAction(actionError("position-not-found", "Liquidity position is not active"));
    }
    if (!isAddressEqual(position.lender, snapshot.identity.account)) {
      return invalidAction(actionError("not-owner", "Connected account does not own this position"));
    }
    if (
      !Number.isSafeInteger(intent.newAprBps) ||
      intent.newAprBps < state.aprMinBps ||
      intent.newAprBps > state.aprMaxBps ||
      intent.newAprBps % APR_STEP_BPS !== 0
    ) {
      return invalidAction(actionError("invalid-apr", "APR is outside the current posting bounds"));
    }
    if (intent.newAprBps === position.aprBps) {
      return invalidAction(actionError("same-rate", "Select a different APR"));
    }
    const authorizations = [
      erc20Authorization({
        token: snapshot.market.underlying,
        spender: lending,
        amount: position.availableLiquidity,
        currentAllowance: state.allowance,
      }),
    ];
    const calls = [
      {
        target: lending,
        contract: "lending" as const,
        functionName: "withdrawLiquidity",
        args: [intent.positionId] as const,
        value: 0n,
      },
      {
        target: lending,
        contract: "lending" as const,
        functionName: "supplyLiquidity",
        args: [snapshot.market.market, intent.newAprBps, position.availableLiquidity] as const,
        value: 0n,
      },
    ];
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "multicall",
      args: [
        calls.map((nestedCall) =>
          nestedCall.functionName === "withdrawLiquidity"
            ? encodeFunctionData({
                abi: ovrfloLendingAbi,
                functionName: "withdrawLiquidity",
                args: [intent.positionId],
              })
            : encodeFunctionData({
                abi: ovrfloLendingAbi,
                functionName: "supplyLiquidity",
                args: [
                  snapshot.market.market,
                  intent.newAprBps,
                  position.availableLiquidity,
                ],
              }),
        ),
      ] as const,
      value: 0n,
      calls,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "ADJUST RATE",
      preconditions: ["fresh-position", "position-owned", "position-active", "apr-postable"],
      authorizations,
      call,
      touchedResources: [
        { kind: "liquidity-position", lending, id: intent.positionId },
        { kind: "market-depth", lending, market: position.market, aprBps: position.aprBps },
        { kind: "market-depth", lending, market: position.market, aprBps: intent.newAprBps },
        {
          kind: "allowance",
          token: snapshot.market.underlying,
          owner: snapshot.identity.account,
          spender: lending,
        },
      ],
      economics: {
        positionId: intent.positionId,
        amount: position.availableLiquidity,
        oldAprBps: position.aprBps,
        newAprBps: intent.newAprBps,
      },
      receiptSummary: {
        source: lending,
        eventName: null,
        label: "RATE ADJUSTED",
        expectedIds: [intent.positionId],
        expectedAmounts: { moved: position.availableLiquidity },
      },
    });
  },
};

export const closeDefinition: ActionDefinition<"close"> = {
  type: "close",
  build(intent, snapshot) {
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Close state is not fresh and complete"));
    }
    const state = snapshot.state.data;
    const loan = state.loan;
    if (!loan || loan.id !== intent.loanId) {
      return invalidAction(actionError("loan-not-found", "Loan was not found"));
    }
    if (!isAddressEqual(loan.borrower, snapshot.identity.account)) {
      return invalidAction(actionError("not-owner", "Connected account is not the borrower"));
    }
    const outstanding = loanOutstanding(loan);
    if (!isLoanOpen(loan)) {
      return invalidAction(actionError("loan-closed", "Loan has no outstanding balance"));
    }
    if (state.withdrawable < outstanding) {
      return invalidAction(
        actionError("loan-not-closable", "Fresh stream value cannot cover the outstanding balance"),
      );
    }
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "closeLoan",
      args: [intent.loanId] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "CLOSE LOAN",
      preconditions: ["fresh-loan", "loan-open", "stream-covers-outstanding"],
      authorizations: [],
      call,
      touchedResources: [
        { kind: "loan", lending, id: intent.loanId },
        { kind: "stream", sablier: snapshot.market.sablier, id: loan.streamId },
      ],
      economics: {
        loanId: intent.loanId,
        outstanding,
        withdrawable: state.withdrawable,
      },
      receiptSummary: {
        source: lending,
        eventName: "LoanClosed",
        label: "CLOSED",
        expectedIds: [intent.loanId, loan.streamId],
        expectedAmounts: { outstanding, withdrawable: state.withdrawable },
      },
    });
  },
};
