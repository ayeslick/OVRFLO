import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  discoverStreamCandidates,
  depositedTopics,
  recipientTransferTopics,
  type DepositedOrigin,
  type RecipientTransfer,
} from "@/lib/discovery/stream-discovery";

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

const WALLET = address(0x11);
const VAULT = address(0xaa);

function origin(streamId: bigint, vault = VAULT): DepositedOrigin {
  return { vault, streamId };
}

function transfer(streamId: bigint, to = WALLET): RecipientTransfer {
  return { streamId, to };
}

describe("discoverStreamCandidates", () => {
  it("builds address-scoped origin and indexed-recipient event filters", () => {
    expect(depositedTopics()).toHaveLength(1);
    const topics = recipientTransferTopics(WALLET);
    expect(topics).toHaveLength(4);
    expect(topics[1]).toBeNull();
    expect(topics[2]).not.toBeNull();
  });

  it("intersects verified-vault origins with recipient transfers before hydration", () => {
    const result = discoverStreamCandidates({
      vaultRegistry: { status: "complete", vaults: [VAULT] },
      origins: [origin(1n), origin(2n), origin(2n)],
      recipientTransfers: [transfer(2n), transfer(3n)],
      recipient: WALLET,
      candidateLimit: 10,
    });
    expect(result).toEqual({
      status: "complete",
      candidateIds: [2n],
      originCount: 2,
      recipientCount: 2,
      intersectionCount: 1,
    });
  });

  it("deduplicates transfer-to, away, and back discovery candidates before hydration", () => {
    const result = discoverStreamCandidates({
      vaultRegistry: { status: "complete", vaults: [VAULT] },
      origins: [origin(9n)],
      recipientTransfers: [transfer(9n), transfer(9n), transfer(9n)],
      recipient: WALLET,
      candidateLimit: 10,
    });
    expect(result.status).toBe("complete");
    expect(result.candidateIds).toEqual([9n]);
    if (result.status !== "unavailable") {
      expect(result.recipientCount).toBe(3);
      expect(result.intersectionCount).toBe(1);
    }
  });

  it("retains only origin-intersecting IDs from thousands of unrelated recipient transfers", () => {
    const spam = Array.from({ length: 5_000 }, (_, index) => transfer(BigInt(10_000 + index)));
    const result = discoverStreamCandidates({
      vaultRegistry: { status: "complete", vaults: [VAULT] },
      origins: [origin(8n), origin(7n)],
      recipientTransfers: [...spam, transfer(7n)],
      recipient: WALLET,
      candidateLimit: 1,
    });
    expect(result).toEqual({
      status: "complete",
      candidateIds: [7n],
      originCount: 2,
      recipientCount: 5_001,
      intersectionCount: 1,
    });
  });

  it("returns explicit partial state when the post-intersection cap is hit", () => {
    const result = discoverStreamCandidates({
      vaultRegistry: { status: "complete", vaults: [VAULT] },
      origins: [origin(1n), origin(2n)],
      recipientTransfers: [transfer(1n), transfer(2n)],
      recipient: WALLET,
      candidateLimit: 1,
    });
    expect(result).toMatchObject({ status: "partial", candidateIds: [1n], intersectionCount: 2 });
  });

  it("never turns an incomplete vault registry into a false empty result", () => {
    const result = discoverStreamCandidates({
      vaultRegistry: { status: "partial", vaults: [VAULT], error: "middle chunk failed" },
      origins: [],
      recipientTransfers: [],
      recipient: WALLET,
      candidateLimit: 10,
    });
    expect(result).toMatchObject({ status: "unavailable", error: "middle chunk failed" });
  });
});
