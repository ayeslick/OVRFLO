import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  PENDLE_ROUTER_CONVERT_ABI,
  PENDLE_ROUTER_V4,
} from "@/lib/hosted-convert";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function encodeHostedSwap(args: {
  account: Address;
  inputToken: Address;
  outputToken: Address;
  pendleMarket: Address;
  amount: bigint;
  minOut?: bigint;
}): Hex {
  return encodeFunctionData({
    abi: PENDLE_ROUTER_CONVERT_ABI,
    functionName: "swapExactTokenForPt",
    args: [
      args.account,
      args.pendleMarket,
      args.minOut ?? (args.amount * 9950n) / 10_000n,
      { guessMin: 0n, guessMax: 0n, guessOffchain: 0n, maxIteration: 0n, eps: 0n },
      {
        tokenIn: args.inputToken,
        netTokenIn: args.amount,
        tokenMintSy: args.inputToken,
        pendleSwap: ZERO,
        swapData: { swapType: 0, extRouter: ZERO, extCalldata: "0x", needScale: false },
      },
      { limitRouter: ZERO, epsSkipMarket: 0n, normalFills: [], flashFills: [], optData: "0x" },
    ],
  });
}

export function hostedConvertResponse(args: {
  account: Address;
  inputToken: Address;
  outputToken: Address;
  pendleMarket: Address;
  amount: bigint;
  minOut?: bigint;
  priceImpact?: number | string | null;
  deadline?: unknown;
  to?: Address;
  value?: string;
  action?: string;
  inputAmount?: bigint;
}): Record<string, unknown> {
  const data = encodeHostedSwap(args);
  return {
    action: args.action ?? "swap",
    inputs: [{ token: args.inputToken, amount: (args.inputAmount ?? args.amount).toString() }],
    requiredApprovals: [
      { token: args.inputToken, amount: args.amount.toString(), spender: PENDLE_ROUTER_V4 },
    ],
    routes: [
      {
        tx: {
          to: args.to ?? PENDLE_ROUTER_V4,
          from: args.account,
          data,
          value: args.value ?? "0",
        },
        outputs: [{ token: args.outputToken, amount: args.amount.toString() }],
        data: {
          ...(args.priceImpact === null ? {} : { priceImpact: args.priceImpact ?? 0.01 }),
          aggregatorType: "none",
          priceImpactBreakDown: {},
          ...(args.deadline !== undefined ? { deadline: args.deadline } : {}),
        },
      },
    ],
  };
}
