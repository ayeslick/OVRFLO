import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { ovrfloAbi } from "@/lib/abis";
import { decodeDepositedStreamId } from "@/lib/deposit-output";

function depositedLog(streamId: bigint) {
  const topics = encodeEventTopics({
    abi: ovrfloAbi,
    eventName: "Deposited",
    args: {
      user: "0x00000000000000000000000000000000000000a1",
      market: "0x00000000000000000000000000000000000000b2",
    },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [10n, 9n, 1n, streamId],
  );
  return {
    data: data as Hex,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
  };
}

describe("deposit output decode", () => {
  it("continues on a unique Deposited.streamId", () => {
    expect(decodeDepositedStreamId([depositedLog(44n)])).toEqual({
      status: "ready",
      streamId: 44n,
    });
  });

  it("blocks when the event is missing", () => {
    expect(decodeDepositedStreamId([])).toEqual({ status: "blocked", reason: "missing" });
    expect(
      decodeDepositedStreamId([{ data: "0x", topics: [`0x${"11".repeat(32)}`] }]),
    ).toEqual({ status: "blocked", reason: "missing" });
  });

  it("blocks when two stream IDs are present", () => {
    expect(decodeDepositedStreamId([depositedLog(44n), depositedLog(45n)])).toEqual({
      status: "blocked",
      reason: "ambiguous",
    });
  });
});
