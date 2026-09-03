import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  createLiveActionDraft,
  createLiveExecutionPlan,
  type LiveClient,
} from "@/lib/live-action-plan";
import { PENDLE_ROUTER_V4 } from "@/lib/hosted-convert";
import { revalidateReview } from "@/lib/actions/registry";
import { WAD } from "@/lib/lending-math";
import type { ReadyProtocolBootstrap } from "@/lib/protocol-bootstrap";
import { hostedConvertResponse } from "./hosted-convert.fixture";

const account = "0x0000000000000000000000000000000000000a11" as Address;
const factory = "0x0000000000000000000000000000000000000f00" as Address;
const vault = "0x0000000000000000000000000000000000000d44" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const stream = "0x0000000000000000000000000000000000000999" as Address;
const market = "0x0000000000000000000000000000000000000c33" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;
const reserve = "0x0000000000000000000000000000000000000c44" as Address;
const pt = "0x0000000000000000000000000000000000000028" as Address;
const amount = 10n * WAD;

const bootstrap: ReadyProtocolBootstrap = {
  status: "ready",
  factory,
  stream,
  blockNumber: 1n,
  vaults: [
    {
      vault,
      treasury: token,
      underlying: token,
      ovrfloToken: token,
      reserve,
      lending,
      retiredLendings: [],
    },
  ],
};

const client = {
  getBlock: vi.fn(async () => ({
    number: 100n,
    hash: `0x${"ab".repeat(32)}` as const,
    timestamp: 1_700_000_000n,
  })),
  readContract: vi.fn(async () => 20n * WAD),
  simulateContract: vi.fn(),
} as unknown as LiveClient;

const scope = {
  vault,
  lending,
  market,
  underlying: token,
  ovrfloToken: token,
  ptToken: pt,
  expiryCached: 1_000n,
  sablier: stream,
  reserve,
};

function rawArgs(response: unknown) {
  return {
    address: PENDLE_ROUTER_V4,
    functionName: "hostedConvert",
    args: [token, pt, amount, 50, false] as const,
    hostedResponse: response,
    disclosure: "default" as const,
  };
}

describe("createLiveActionDraft Hosted Convert", () => {
  it("re-decodes hostedConvert as a dedicated action and never returns legacy null", async () => {
    const response = hostedConvertResponse({
      account,
      inputToken: token,
      outputToken: pt,
      pendleMarket: market,
      amount,
    });
    const draft = await createLiveActionDraft(
      rawArgs(response),
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(draft).not.toBeNull();
    expect(draft?.status).toBe("ready");
    if (draft?.status !== "ready") throw new Error("expected ready");
    expect(draft.draft.action.type).toBe("hosted_convert");
    expect(draft.draft.action.call.contract).toBe("pendle_router");
    expect(draft.draft.action.call.target).toBe(PENDLE_ROUTER_V4);
    expect(draft.draft.request.hostedConvert).toBe(true);
  });

  it("refuses an undecoded Router write as invalid, not a legacy raw-call", async () => {
    const result = await createLiveActionDraft(
      {
        address: PENDLE_ROUTER_V4,
        functionName: "swapExactTokenForPt",
        args: [],
      },
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
  });

  it("marks a changed hosted response as needs-review", async () => {
    const first = hostedConvertResponse({
      account,
      inputToken: token,
      outputToken: pt,
      pendleMarket: market,
      amount,
    });
    const second = hostedConvertResponse({
      account,
      inputToken: token,
      outputToken: pt,
      pendleMarket: market,
      amount,
      minOut: (amount * 9960n) / 10_000n,
    });
    const initial = await createLiveActionDraft(
      rawArgs(first),
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    const changed = await createLiveActionDraft(
      rawArgs(second),
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(initial?.status).toBe("ready");
    expect(changed?.status).toBe("ready");
    if (initial?.status !== "ready" || changed?.status !== "ready") {
      throw new Error("expected two ready drafts");
    }
    expect(changed.draft.action.call.data).not.toBe(initial.draft.action.call.data);
    expect(revalidateReview(initial.draft.action.review, changed.draft.action.review).status).toBe(
      "needs-review",
    );
  });

  it("rebuilds and simulates from the same raw hosted response", async () => {
    const response = hostedConvertResponse({
      account,
      inputToken: token,
      outputToken: pt,
      pendleMarket: market,
      amount,
    });
    const plan = await createLiveExecutionPlan(
      rawArgs(response),
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(plan?.status).toBe("ready");
    if (plan?.status !== "ready") throw new Error("expected ready plan");
    const rebuilt = await plan.plan.rebuild({ account, chainId: 1 });
    expect(rebuilt.status).toBe("ready");
  });
});
