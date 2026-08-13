import { isAddressEqual } from "viem";
import { isLoanOpen, loanOutstanding } from "../lending-math";
import { isFreshReady } from "../read-outcome";
import {
  actionError,
  erc20Authorization,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
} from "./types";

export const repayDefinition: ActionDefinition<"repay"> = {
  type: "repay",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    const lending = snapshot.market.lending;
    if (!lending) {
      return invalidAction(actionError("market-not-configured", "Lending is not deployed"));
    }
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Repay state is not fresh and complete"));
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
    if (parsed.amount > outstanding) {
      return invalidAction(
        actionError("amount-over-capacity", "Repay amount exceeds the fresh outstanding balance"),
      );
    }
    if (parsed.amount > state.walletBalance) {
      return invalidAction(actionError("wallet-insufficient", "Repay amount exceeds wallet balance"));
    }
    const authorizations = [
      erc20Authorization({
        token: snapshot.market.ovrfloToken,
        spender: lending,
        amount: parsed.amount,
        currentAllowance: state.allowance,
      }),
    ];
    const call = {
      target: lending,
      contract: "lending" as const,
      functionName: "repay",
      args: [intent.loanId, parsed.amount] as const,
      value: 0n,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "REPAY LOAN",
      preconditions: ["fresh-loan", "loan-open", "amount-valid", "wallet-funded"],
      authorizations,
      call,
      touchedResources: [
        { kind: "loan", lending, id: intent.loanId },
        {
          kind: "token-balance",
          token: snapshot.market.ovrfloToken,
          account: snapshot.identity.account,
        },
        {
          kind: "allowance",
          token: snapshot.market.ovrfloToken,
          owner: snapshot.identity.account,
          spender: lending,
        },
      ],
      economics: { loanId: intent.loanId, amount: parsed.amount, outstanding },
      receiptSummary: {
        source: lending,
        eventName: "Repaid",
        label: "REPAID",
        expectedIds: [intent.loanId],
        expectedAmounts: { repaid: parsed.amount, outstandingBefore: outstanding },
      },
    });
  },
};
