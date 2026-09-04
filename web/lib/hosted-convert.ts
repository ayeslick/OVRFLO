import {
  decodeFunctionData,
  isAddress,
  isAddressEqual,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS } from "./borrow";
import { ZERO_ADDRESS, chainId as configuredChainId, runtimeProfile } from "./config";
import { MAX_PENDLE_PRICE_IMPACT_BPS, PENDLE_SLIPPAGE_BPS } from "./default/policy";
import type { DisclosureLevel } from "./disclosure";

export const PENDLE_ROUTER_V4 = "0x888888888889758F76e7103c6CbF23ABbF58F946" as const;
export const PENDLE_HOSTED_ORIGIN = "https://api-v2.pendle.finance";
export const HOSTED_CONVERT_PATH = "/core/v3/sdk";

export const HOSTED_IMPACT_COPY = "This amount would move the PT market too much";
export const HOSTED_LOCAL_UNAVAILABLE_COPY = "Hosted Convert is unavailable on a local fork";

export const HOSTED_CONVERT_ACTIONS = ["smaller-amount", "open-advanced"] as const;
export type HostedConvertAction = (typeof HOSTED_CONVERT_ACTIONS)[number];

export const PENDLE_ROUTER_CONVERT_ABI = [
  {
    type: "function",
    name: "swapExactTokenForPt",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "market", type: "address" },
      { name: "minPtOut", type: "uint256" },
      {
        name: "guessPtOut",
        type: "tuple",
        components: [
          { name: "guessMin", type: "uint256" },
          { name: "guessMax", type: "uint256" },
          { name: "guessOffchain", type: "uint256" },
          { name: "maxIteration", type: "uint256" },
          { name: "eps", type: "uint256" },
        ],
      },
      {
        name: "input",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "netTokenIn", type: "uint256" },
          { name: "tokenMintSy", type: "address" },
          { name: "pendleSwap", type: "address" },
          {
            name: "swapData",
            type: "tuple",
            components: [
              { name: "swapType", type: "uint8" },
              { name: "extRouter", type: "address" },
              { name: "extCalldata", type: "bytes" },
              { name: "needScale", type: "bool" },
            ],
          },
        ],
      },
      {
        name: "limit",
        type: "tuple",
        components: [
          { name: "limitRouter", type: "address" },
          { name: "epsSkipMarket", type: "uint256" },
          { name: "normalFills", type: "tuple[]", components: [] },
          { name: "flashFills", type: "tuple[]", components: [] },
          { name: "optData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "netPtOut", type: "uint256" },
      { name: "netSyFee", type: "uint256" },
    ],
  },
] as const;

const ALLOWED_METHODS = new Set(["swapExactTokenForPt"]);
const ALLOWED_ACTIONS = new Set(["swap", "pendle-swap"]);

export type HostedConvertIntentInput = {
  chainId: number;
  account: Address;
  inputToken: Address;
  outputToken: Address;
  pendleMarket: Address;
  amountIn: bigint;
  slippageBps: bigint;
  enableAggregator: boolean;
  now: bigint;
  disclosure: DisclosureLevel;
};

export type HostedTokenAmount = {
  token: Address;
  amount: bigint;
  spender?: Address;
};

export type ValidatedHostedConvert = {
  status: "ok";
  action: string;
  method: string;
  input: HostedTokenAmount;
  output: HostedTokenAmount;
  approvals: readonly HostedTokenAmount[];
  tx: { to: Address; from: Address; data: Hex; value: bigint };
  minOut: bigint;
  impactBps: bigint;
  slippageBps: bigint;
  deadline: bigint | null;
};

export function isHostedReject(value: unknown): value is HostedConvertReject {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: unknown }).status === "reject" &&
    "code" in value &&
    "message" in value
  );
}

export type HostedConvertReject = {
  status: "reject";
  code:
    | "hosted-unavailable"
    | "hosted-chain-mismatch"
    | "hosted-token-mismatch"
    | "hosted-router-mismatch"
    | "hosted-semantics"
    | "hosted-bounds"
    | "hosted-deadline"
    | "hosted-impact"
    | "hosted-response";
  message: string;
};

export type HostedPolicyDecision =
  | { status: "pass"; impactBps: bigint; slippageBps: bigint }
  | {
      status: "reject-impact";
      copy: typeof HOSTED_IMPACT_COPY;
      actions: readonly HostedConvertAction[];
    }
  | { status: "unavailable"; copy: typeof HOSTED_LOCAL_UNAVAILABLE_COPY };

export function hostedConvertEnabled(): boolean {
  return runtimeProfile !== "local";
}

export function hostedConvertUrl(chainId: number): string {
  return `${PENDLE_HOSTED_ORIGIN}${HOSTED_CONVERT_PATH}/${chainId}/convert`;
}

export function slippageAsApiRatio(slippageBps: bigint): number {
  return Number(slippageBps) / 10_000;
}

export function resolveHostedSlippageBps(
  disclosure: DisclosureLevel,
  requested?: bigint,
): bigint {
  if (disclosure !== "advanced") return PENDLE_SLIPPAGE_BPS;
  if (requested === undefined) return PENDLE_SLIPPAGE_BPS;
  if (requested < SLIPPAGE_MIN_BPS || requested > SLIPPAGE_MAX_BPS) {
    return PENDLE_SLIPPAGE_BPS;
  }
  return requested;
}

export function priceImpactToBps(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.round(Math.abs(raw) * 10_000)) * (raw < 0 ? -1n : 1n);
  }
  if (typeof raw === "string" && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    const [whole = "0", frac = ""] = raw.replace(/^-/, "").split(".");
    const negative = raw.startsWith("-");
    const frac4 = (frac + "0000").slice(0, 4);
    const leftover = frac.slice(4);
    const bump = leftover.split("").some((digit) => digit !== "0") ? 1n : 0n;
    const value = BigInt(whole) * 10_000n + BigInt(frac4) + bump;
    return negative ? -value : value;
  }
  return null;
}

export function evaluateHostedPolicy(
  disclosure: DisclosureLevel,
  impactBps: bigint,
): HostedPolicyDecision {
  if (disclosure !== "advanced" && impactBps > MAX_PENDLE_PRICE_IMPACT_BPS) {
    return {
      status: "reject-impact",
      copy: HOSTED_IMPACT_COPY,
      actions: HOSTED_CONVERT_ACTIONS,
    };
  }
  return {
    status: "pass",
    impactBps,
    slippageBps: resolveHostedSlippageBps(disclosure),
  };
}

export function hostedConvertRequestBody(intent: HostedConvertIntentInput): Record<string, unknown> {
  return {
    slippage: slippageAsApiRatio(intent.slippageBps),
    enableAggregator: intent.enableAggregator,
    receiver: intent.account,
    inputs: [{ token: intent.inputToken, amount: intent.amountIn.toString() }],
    outputs: [intent.outputToken],
  };
}

export async function requestHostedConvert(
  intent: HostedConvertIntentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | HostedConvertReject> {
  if (!hostedConvertEnabled()) {
    return {
      status: "reject",
      code: "hosted-unavailable",
      message: HOSTED_LOCAL_UNAVAILABLE_COPY,
    };
  }
  if (intent.chainId !== configuredChainId) {
    return {
      status: "reject",
      code: "hosted-chain-mismatch",
      message: "Hosted Convert chain does not match the configured chain",
    };
  }
  const response = await fetchImpl(hostedConvertUrl(intent.chainId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hostedConvertRequestBody(intent)),
  });
  if (!response.ok) {
    return {
      status: "reject",
      code: "hosted-response",
      message: "Hosted Convert request failed",
    };
  }
  return response.json();
}

export function validateHostedResponse(
  raw: unknown,
  intent: HostedConvertIntentInput,
): ValidatedHostedConvert | HostedConvertReject {
  if (intent.chainId !== configuredChainId || intent.chainId !== 1) {
    return {
      status: "reject",
      code: "hosted-chain-mismatch",
      message: "Hosted Convert chain does not match Ethereum",
    };
  }
  if (!isRecord(raw)) {
    return rejectResponse("Hosted Convert response is not an object");
  }
  if (typeof raw.action !== "string" || !ALLOWED_ACTIONS.has(raw.action)) {
    return rejectSemantics("Hosted Convert action is not a token-to-PT conversion");
  }
  const routes = raw.routes;
  if (!Array.isArray(routes) || routes[0] === undefined || !isRecord(routes[0])) {
    return rejectResponse("Hosted Convert response lacks routes[0]");
  }
  const route = routes[0];
  if (!isRecord(route.tx) || !isRecord(route.data)) {
    return rejectResponse("Hosted Convert route is missing tx or data");
  }
  const tx = parseTx(route.tx, intent.account);
  if ("status" in tx) return tx;
  if (!isAddressEqual(intent.inputToken, ZERO_ADDRESS) && tx.value !== 0n) {
    return {
      status: "reject",
      code: "hosted-bounds",
      message: "Hosted Convert attaches native value to a token input",
    };
  }

  const inputs = parseTokenAmounts(raw.inputs, "input");
  if ("status" in inputs) return inputs;
  const outputs = parseTokenAmounts(route.outputs, "output");
  if ("status" in outputs) return outputs;
  const approvals = parseTokenAmounts(raw.requiredApprovals ?? [], "approval");
  if ("status" in approvals) return approvals;

  const input = inputs.find((row) => isAddressEqual(row.token, intent.inputToken));
  const output = outputs.find((row) => isAddressEqual(row.token, intent.outputToken));
  if (!input || !output) {
    return {
      status: "reject",
      code: "hosted-token-mismatch",
      message: "Hosted Convert tokens do not match the selected conversion",
    };
  }
  if (input.amount !== intent.amountIn) {
    return {
      status: "reject",
      code: "hosted-bounds",
      message: "Hosted Convert input amount does not match the requested amount",
    };
  }

  for (const approval of approvals) {
    const spender = approval.spender ?? tx.to;
    if (!isAddressEqual(spender, PENDLE_ROUTER_V4)) {
      return {
        status: "reject",
        code: "hosted-router-mismatch",
        message: "Hosted Convert spender is not Pendle Router V4",
      };
    }
  }

  const decoded = decodeHostedCalldata(tx.data, intent);
  if ("status" in decoded) return decoded;

  const minOut = decoded.minOut;
  const floor = (output.amount * (10_000n - intent.slippageBps)) / 10_000n;
  if (minOut < floor || output.amount < minOut) {
    return {
      status: "reject",
      code: "hosted-bounds",
      message: "Hosted Convert output bounds miss the slippage interval",
    };
  }

  const deadline = extractDeadline(route.data, raw);
  if (deadline !== null && deadline <= intent.now) {
    return {
      status: "reject",
      code: "hosted-deadline",
      message: "Hosted Convert deadline has passed",
    };
  }

  const parsedImpact = priceImpactToBps(route.data.priceImpact);
  if (parsedImpact === null) {
    return rejectResponse("Hosted Convert price impact is missing");
  }
  const impactBps = absBps(parsedImpact);
  const policy = evaluateHostedPolicy(intent.disclosure, impactBps);
  if (policy.status === "reject-impact") {
    return { status: "reject", code: "hosted-impact", message: policy.copy };
  }

  return {
    status: "ok",
    action: raw.action,
    method: decoded.method,
    input,
    output,
    approvals,
    tx,
    minOut,
    impactBps,
    slippageBps: intent.slippageBps,
    deadline,
  };
}

function absBps(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectResponse(message: string): HostedConvertReject {
  return { status: "reject", code: "hosted-response", message };
}

function rejectSemantics(message: string): HostedConvertReject {
  return { status: "reject", code: "hosted-semantics", message };
}

function parseTx(
  raw: Record<string, unknown>,
  account: Address,
): { to: Address; from: Address; data: Hex; value: bigint } | HostedConvertReject {
  if (typeof raw.to !== "string" || !isAddress(raw.to)) {
    return { status: "reject", code: "hosted-router-mismatch", message: "Hosted Convert tx.to is missing" };
  }
  if (!isAddressEqual(raw.to, PENDLE_ROUTER_V4)) {
    return {
      status: "reject",
      code: "hosted-router-mismatch",
      message: "Hosted Convert tx.to is not Pendle Router V4",
    };
  }
  if (typeof raw.from !== "string" || !isAddress(raw.from) || !isAddressEqual(raw.from, account)) {
    return {
      status: "reject",
      code: "hosted-token-mismatch",
      message: "Hosted Convert tx.from is not the connected account",
    };
  }
  if (typeof raw.data !== "string" || !isHex(raw.data) || raw.data.length < 10) {
    return rejectSemantics("Hosted Convert calldata is missing");
  }
  if (typeof raw.value === "number") {
    return rejectSemantics("Hosted Convert tx.value must be a string");
  }
  let value = 0n;
  if (raw.value !== undefined && raw.value !== null) {
    if (typeof raw.value !== "string") {
      return rejectSemantics("Hosted Convert tx.value must be a string");
    }
    try {
      value = BigInt(raw.value);
    } catch {
      return rejectSemantics("Hosted Convert tx.value is not an integer");
    }
  }
  return { to: raw.to, from: raw.from, data: raw.data, value };
}

function parseTokenAmounts(
  raw: unknown,
  label: string,
): HostedTokenAmount[] | HostedConvertReject {
  if (!Array.isArray(raw)) {
    return rejectResponse(`Hosted Convert ${label} list is missing`);
  }
  const rows: HostedTokenAmount[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.token !== "string" || !isAddress(item.token)) {
      return rejectResponse(`Hosted Convert ${label} token is invalid`);
    }
    if (typeof item.amount === "number") {
      return rejectSemantics(`Hosted Convert ${label} amount must be a string`);
    }
    if (typeof item.amount !== "string") {
      return rejectResponse(`Hosted Convert ${label} amount is invalid`);
    }
    let amount: bigint;
    try {
      amount = BigInt(item.amount);
    } catch {
      return rejectResponse(`Hosted Convert ${label} amount is not an integer`);
    }
    const spender =
      typeof item.spender === "string" && isAddress(item.spender) ? item.spender : undefined;
    rows.push({ token: item.token, amount, spender });
  }
  return rows;
}

function decodeHostedCalldata(
  data: Hex,
  intent: HostedConvertIntentInput,
): { method: string; minOut: bigint } | HostedConvertReject {
  try {
    const decoded = decodeFunctionData({ abi: PENDLE_ROUTER_CONVERT_ABI, data });
    if (!ALLOWED_METHODS.has(decoded.functionName)) {
      return rejectSemantics("Hosted Convert selector is not an allowed Router V4 method");
    }
    const receiver = decoded.args[0];
    if (typeof receiver !== "string" || !isAddressEqual(receiver, intent.account)) {
      return rejectSemantics("Hosted Convert receiver is not the connected account");
    }
    const market = decoded.args[1];
    const minPtOut = decoded.args[2];
    const input = decoded.args[4];
    if (typeof market !== "string" || !isAddressEqual(market, intent.pendleMarket)) {
      return {
        status: "reject",
        code: "hosted-token-mismatch",
        message: "Hosted Convert calldata market does not match the selected term",
      };
    }
    if (typeof minPtOut !== "bigint" || !input || typeof input !== "object") {
      return rejectSemantics("Hosted Convert swap args are incomplete");
    }
    const tokenIn = "tokenIn" in input ? input.tokenIn : undefined;
    const netTokenIn = "netTokenIn" in input ? input.netTokenIn : undefined;
    if (typeof tokenIn !== "string" || !isAddressEqual(tokenIn, intent.inputToken)) {
      return {
        status: "reject",
        code: "hosted-token-mismatch",
        message: "Hosted Convert calldata tokenIn does not match",
      };
    }
    if (typeof netTokenIn !== "bigint" || netTokenIn !== intent.amountIn) {
      return {
        status: "reject",
        code: "hosted-bounds",
        message: "Hosted Convert calldata amount does not match",
      };
    }
    return { method: decoded.functionName, minOut: minPtOut };
  } catch {
    return rejectSemantics("Hosted Convert calldata does not decode as an allowed method");
  }
}

function extractDeadline(data: Record<string, unknown>, raw: Record<string, unknown>): bigint | null {
  const candidates = [data.deadline, raw.deadline];
  for (const value of candidates) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  }
  return null;
}
