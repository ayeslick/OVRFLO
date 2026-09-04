import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { ZERO_ADDRESS } from "@/lib/config";
import { WAD } from "@/lib/lending-math";
import {
  createLiveActionDraft,
  type LiveBorrowProjectionLoader,
} from "@/lib/live-action-plan";
import type { ReadyProtocolBootstrap } from "@/lib/protocol-bootstrap";
import type { LiquidityPosition } from "@/lib/types";

const account = "0x0000000000000000000000000000000000000a11" as Address;
const other = "0x0000000000000000000000000000000000000b22" as Address;
const factory = "0x0000000000000000000000000000000000000f00" as Address;
const vault = "0x0000000000000000000000000000000000000d44" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const stream = "0x0000000000000000000000000000000000000999" as Address;
const market = "0x0000000000000000000000000000000000000c33" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;
const reserve = "0x0000000000000000000000000000000000000c44" as Address;
const book = "0x0000000000000000000000000000000000000e55" as Address;

const identity = { account, chainId: 1 };
const expiry = 2_000_000_000n;
const now = 1_800_000_000n;
const streamId = 31n;
const aprBps = 1_000;
const amountWei = 4n * WAD;
const feeAmount = (amountWei * 25n) / 10_000n;
const minAcceptable = (amountWei * 9_925n) / 10_000n;

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

const scope = {
  vault,
  lending,
  market,
  underlying: token,
  ovrfloToken: token,
  ptToken: token,
  expiryCached: expiry,
  sablier: stream,
  reserve,
  requestBook: book,
};

const eligibleStream = {
  sender: vault,
  startTime: 100n,
  cliffTime: 100n,
  isCancelable: false,
  wasCanceled: false,
  asset: token,
  endTime: expiry,
  isDepleted: false,
  isStream: true,
  isTransferable: true,
  amounts: { deposited: WAD, withdrawn: 0n, refunded: 0n },
};

const positions: readonly LiquidityPosition[] = [
  {
    id: 4n,
    lender: other,
    market,
    aprBps,
    availableLiquidity: 12n * WAD,
  },
];

const loadProjection: LiveBorrowProjectionLoader = async () => ({
  positions,
  aggregateDepth: 12n * WAD,
});

function mockClient(streamRow: typeof eligibleStream) {
  const client = {
    getBlock: vi.fn(),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  };
  client.getBlock.mockResolvedValue({
    number: 10n,
    hash: `0x${"11".repeat(32)}`,
    timestamp: now,
  });
  client.readContract.mockImplementation(async (request: { functionName: string }) => {
    switch (request.functionName) {
      case "getRecipient":
        return account;
      case "getApproved":
        return ZERO_ADDRESS;
      case "isApprovedForAll":
        return true;
      case "getStream":
        return streamRow;
      case "router":
        return book;
      default:
        throw new Error(`unexpected read ${request.functionName}`);
    }
  });
  client.simulateContract.mockResolvedValue({
    result: [amountWei, feeAmount, 5n * WAD],
  });
  return client;
}

describe("createLiveActionDraft borrow projection", () => {
  it("fails routing-incomplete when no projection loader runs", async () => {
    const result = await createLiveActionDraft(
      {
        address: lending,
        functionName: "borrow",
        args: [market, aprBps, amountWei, streamId, minAcceptable, account],
      },
      identity,
      scope,
      mockClient(eligibleStream),
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "routing-incomplete" })],
    });
  });

  it("returns a ready draft when the projection conserves", async () => {
    const result = await createLiveActionDraft(
      {
        address: lending,
        functionName: "borrow",
        args: [market, aprBps, amountWei, streamId, minAcceptable, account],
      },
      identity,
      scope,
      mockClient(eligibleStream),
      { bootstrap, loadBorrowProjection: loadProjection },
    );
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("expected ready borrow draft");
    expect(result.draft.action.call.functionName).toBe("borrow");
    expect(result.draft.action.call.args).toEqual([
      market,
      aprBps,
      amountWei,
      streamId,
      minAcceptable,
      account,
    ]);
  });

  it("fails stream-ineligible when getStream is not borrow collateral", async () => {
    const result = await createLiveActionDraft(
      {
        address: lending,
        functionName: "borrow",
        args: [market, aprBps, amountWei, streamId, minAcceptable, account],
      },
      identity,
      scope,
      mockClient({ ...eligibleStream, isCancelable: true }),
      { bootstrap, loadBorrowProjection: loadProjection },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "stream-ineligible" })],
    });
  });
});

describe("createLiveActionDraft post_request eligibility", () => {
  it("fails stream-ineligible when getStream is not borrow collateral", async () => {
    const result = await createLiveActionDraft(
      {
        address: book,
        functionName: "post",
        args: [streamId, market, aprBps, amountWei, minAcceptable],
      },
      identity,
      scope,
      mockClient({ ...eligibleStream, isCancelable: true }),
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "stream-ineligible" })],
    });
  });

  it("returns a ready draft when the stream is eligible and the book matches router", async () => {
    const result = await createLiveActionDraft(
      {
        address: book,
        functionName: "post",
        args: [streamId, market, aprBps, amountWei, minAcceptable],
      },
      identity,
      scope,
      mockClient(eligibleStream),
      { bootstrap },
    );
    expect(result?.status).toBe("ready");
  });
});
