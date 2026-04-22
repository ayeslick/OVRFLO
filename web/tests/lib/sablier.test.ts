/**
 * Tests: T-WEB-008, T-WEB-009
 *
 * T-WEB-008: Happy path of the Sablier Envio indexer GraphQL query.
 * T-WEB-009: Failure modes (empty input, HTTP error, GraphQL error, network throw).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUserStreams, StreamScanError } from "@/lib/sablier";
import { SABLIER_INDEXER_URL } from "@/lib/config";

const USER = "0x0000000000000000000000000000000000000001" as const;
const OVRFLO = "0x000000000000000000000000000000000000ABCD" as const;

// Indexer row = SablierStream minus `depleted` (derived client-side from
// intactAmount === "0").
const SAMPLE_ROW = {
  id: "mainnet-42",
  tokenId: "42",
  depositAmount: "300",
  withdrawnAmount: "0",
  startTime: "1700000000",
  endTime: "1800000000",
  canceled: false,
  intactAmount: "300",
  asset: {
    symbol: "ovrfloUSDC",
    decimals: 18,
    address: "0x000000000000000000000000000000000000BEEF",
  },
  sender: OVRFLO.toLowerCase(),
};

const DEPLETED_ROW = { ...SAMPLE_ROW, id: "mainnet-7", tokenId: "7", intactAmount: "0" };

function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  return vi.fn().mockResolvedValue({
    ok,
    status: init.status ?? (ok ? 200 : 500),
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchUserStreams (T-WEB-008, T-WEB-009)", () => {
  it("T-WEB-009: returns [] and does not call fetch when ovrfloAddresses is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUserStreams({
      user: USER,
      ovrfloAddresses: [],
    });

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-WEB-008: posts to the Sablier Envio endpoint and returns LockupStream[]", async () => {
    const fetchMock = mockFetchResponse({ data: { LockupStream: [SAMPLE_ROW] } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUserStreams({
      user: USER,
      ovrfloAddresses: [OVRFLO],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SABLIER_INDEXER_URL);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.variables.user).toBe(USER.toLowerCase());
    expect(body.variables.senders).toEqual([OVRFLO.toLowerCase()]);
    expect(body.query).toContain("LockupStream(");
    // Category filter pins to LockupLinear so tranched/dynamic streams don't leak in.
    expect(body.query).toContain('category: { _eq: "LockupLinear" }');
    // `depleted` is derived client-side, not selected from the indexer.
    expect(body.query).not.toMatch(/\bdepleted\b/);

    expect(result).toHaveLength(1);
    expect(result[0].tokenId).toBe("42");
    expect(result[0].asset.symbol).toBe("ovrfloUSDC");
    expect(result[0].sender).toBe(OVRFLO.toLowerCase());
    expect(result[0].depleted).toBe(false);
  });

  it("T-WEB-008: returns [] when the indexer responds with an empty LockupStream array", async () => {
    const fetchMock = mockFetchResponse({ data: { LockupStream: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUserStreams({
      user: USER,
      ovrfloAddresses: [OVRFLO],
    });

    expect(result).toEqual([]);
  });

  it("T-WEB-008: derives depleted=true when intactAmount is \"0\"", async () => {
    const fetchMock = mockFetchResponse({
      data: { LockupStream: [SAMPLE_ROW, DEPLETED_ROW] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUserStreams({
      user: USER,
      ovrfloAddresses: [OVRFLO],
    });

    expect(result).toHaveLength(2);
    const depleted = result.find((s) => s.id === DEPLETED_ROW.id)!;
    const live = result.find((s) => s.id === SAMPLE_ROW.id)!;
    expect(depleted.depleted).toBe(true);
    expect(live.depleted).toBe(false);
  });

  it("T-WEB-009: throws StreamScanError on non-2xx HTTP response", async () => {
    const fetchMock = mockFetchResponse({}, { ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchUserStreams({ user: USER, ovrfloAddresses: [OVRFLO] })
    ).rejects.toBeInstanceOf(StreamScanError);
  });

  it("T-WEB-009: throws StreamScanError when the response contains GraphQL errors", async () => {
    const fetchMock = mockFetchResponse({
      errors: [{ message: "bad query" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchUserStreams({ user: USER, ovrfloAddresses: [OVRFLO] })
    ).rejects.toBeInstanceOf(StreamScanError);
  });

  it("T-WEB-009: wraps fetch rejections in StreamScanError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchUserStreams({ user: USER, ovrfloAddresses: [OVRFLO] })
    ).rejects.toBeInstanceOf(StreamScanError);
  });
});
