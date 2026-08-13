import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { streamIdFromLogs } from "@/components/assets/helpers";
import { ovrfloAbi } from "@/lib/abis";

describe("streamIdFromLogs", () => {
  it("reads stream id from a Deposited log", () => {
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
      [10n, 9n, 1n, 42n],
    );
    expect(
      streamIdFromLogs([
        {
          data: data as Hex,
          topics: topics as [`0x${string}`, ...`0x${string}`[]],
        },
      ]),
    ).toBe(42n);
  });

  it("returns null when logs are unrelated", () => {
    expect(
      streamIdFromLogs([
        {
          data: "0x",
          topics: [`0x${"11".repeat(32)}`],
        },
      ]),
    ).toBeNull();
  });
});
