/**
 * Tests: T-WEB-008, T-WEB-009
 *
 * T-WEB-008: Handle GraphQL error payloads safely in stream fetcher.
 * T-WEB-009: Handle non-2xx indexer responses safely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { fetchUserStreams, SablierIndexerError } = await import("@/lib/sablier");

describe("fetchUserStreams (T-WEB-008, T-WEB-009)", () => {
  it("T-WEB-008: throws SablierIndexerError on GraphQL error payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errors: [{ message: "some graphql error" }],
        data: null,
      }),
    });

    await expect(
      fetchUserStreams("0xuser", ["0xovrflo1"])
    ).rejects.toThrow(SablierIndexerError);
  });

  it("T-WEB-008: returns streams when data is valid", async () => {
    const mockStream = {
      id: "1",
      tokenId: "123",
      depositAmount: "1000",
      withdrawnAmount: "0",
      startTime: "1700000000",
      endTime: "1800000000",
      canceled: false,
      depleted: false,
      intactAmount: "1000",
      asset: { symbol: "OVRFLO", decimals: 18, address: "0xasset" },
      sender: "0xovrflo1",
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { Stream: [mockStream] } }),
    });

    const result = await fetchUserStreams("0xuser", ["0xovrflo1"]);
    expect(result).toHaveLength(1);
    expect(result[0].tokenId).toBe("123");
  });

  it("T-WEB-009: returns empty array on empty sender list", async () => {
    const result = await fetchUserStreams("0xuser", []);
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("T-WEB-009: throws SablierIndexerError on non-2xx response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
    });

    await expect(
      fetchUserStreams("0xuser", ["0xovrflo1"])
    ).rejects.toThrow("Sablier indexer returned 502");
  });

  it("T-WEB-009: handles network/fetch error gracefully", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error")
    );

    await expect(
      fetchUserStreams("0xuser", ["0xovrflo1"])
    ).rejects.toThrow("Network error");
  });
});
