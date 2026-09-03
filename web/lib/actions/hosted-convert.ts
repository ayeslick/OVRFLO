import { isFreshReady } from "../read-outcome";
import {
  PENDLE_ROUTER_V4,
  resolveHostedSlippageBps,
  validateHostedResponse,
  type HostedConvertIntentInput,
} from "../hosted-convert";
import {
  actionError,
  erc20Authorization,
  invalidAction,
  parsePositiveAmount,
  readyAction,
  type ActionDefinition,
} from "./types";

export const hostedConvertDefinition: ActionDefinition<"hosted_convert"> = {
  type: "hosted_convert",
  build(intent, snapshot) {
    const parsed = parsePositiveAmount(intent.amount);
    if (!parsed.ok) return invalidAction(parsed.error);
    if (!isFreshReady(snapshot.state)) {
      return invalidAction(actionError("snapshot-not-ready", "Hosted Convert state is not fresh and complete"));
    }
    const state = snapshot.state.data;
    if (parsed.amount > state.walletBalance) {
      return invalidAction(actionError("wallet-insufficient", "Amount exceeds input-token wallet balance"));
    }
    if (intent.outputToken.toLowerCase() !== snapshot.market.ptToken.toLowerCase()) {
      return invalidAction(
        actionError("hosted-token-mismatch", "Hosted Convert output is not the selected PT"),
      );
    }
    const slippageBps = resolveHostedSlippageBps(
      state.disclosure,
      BigInt(intent.slippageBps),
    );
    const hostedIntent: HostedConvertIntentInput = {
      chainId: snapshot.identity.chainId,
      account: snapshot.identity.account,
      inputToken: intent.inputToken,
      outputToken: intent.outputToken,
      pendleMarket: snapshot.market.market,
      amountIn: parsed.amount,
      slippageBps,
      enableAggregator: intent.enableAggregator,
      now: state.now,
      disclosure: state.disclosure,
    };
    const validated = validateHostedResponse(state.response, hostedIntent);
    if (validated.status === "reject") {
      return invalidAction(actionError(validated.code, validated.message));
    }
    const authorizations = [
      erc20Authorization({
        token: validated.input.token,
        spender: PENDLE_ROUTER_V4,
        amount: validated.input.amount,
        currentAllowance: state.allowance,
      }),
    ];
    const call = {
      target: PENDLE_ROUTER_V4,
      contract: "pendle_router" as const,
      functionName: "hostedConvert",
      args: [
        intent.inputToken,
        intent.outputToken,
        parsed.amount,
        Number(slippageBps),
        intent.enableAggregator,
      ] as const,
      value: validated.tx.value,
      data: validated.tx.data,
    };
    return readyAction({
      type: intent.type,
      identity: snapshot.identity,
      title: "HOSTED CONVERT",
      preconditions: ["fresh-state", "hosted-response-valid", "router-allowlist"],
      authorizations,
      call,
      touchedResources: [
        { kind: "market", vault: snapshot.market.vault, market: snapshot.market.market },
        { kind: "token-balance", token: intent.inputToken, account: snapshot.identity.account },
        { kind: "token-balance", token: intent.outputToken, account: snapshot.identity.account },
        {
          kind: "allowance",
          token: intent.inputToken,
          owner: snapshot.identity.account,
          spender: PENDLE_ROUTER_V4,
        },
      ],
      economics: {
        amount: parsed.amount,
        minOut: validated.minOut,
        impactBps: validated.impactBps,
        slippageBps,
      },
      receiptSummary: {
        source: PENDLE_ROUTER_V4,
        eventName: null,
        label: "HOSTED CONVERT",
        expectedIds: [],
        expectedAmounts: { in: parsed.amount, minOut: validated.minOut },
      },
    });
  },
};
