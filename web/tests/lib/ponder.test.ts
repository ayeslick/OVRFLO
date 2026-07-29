import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchHeldStreamIds/fetchBorrowDemand default their baseUrl param to the
// ambient `ponderUrl` from lib/config — so passing `undefined` explicitly is
// NOT the same as "no argument", it just re-derives the same ambient value.
// Pinning ponderUrl to undefined makes every "unconfigured indexer" test
// deterministic regardless of the real .env (bootstrap:local's write-env.sh
// sets NEXT_PUBLIC_PONDER_URL, which would otherwise silently turn these into
// "configured indexer" tests).
vi.mock("@/lib/config", () => ({ ponderUrl: undefined }));

import { fetchBorrowDemand, fetchHeldStreamIds } from "@/lib/ponder";
import { DEMAND_WINDOW_SECONDS } from "@/lib/demand";

const USER = "0x1234567890ABCDEF1234567890abcdef12345678" as const;
const MARKET = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" as const;
const BASE = "https://indexer.example.com";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) });

// R38: the client speaks to two fixed endpoints rather than issuing SQL. These
// tests pin the request shape as much as the parsing — the whole point of the
// change is that the surface is narrow and knowable.
describe("fetchHeldStreamIds", () => {
  it("returns ids only, parsed as bigints", async () => {
    // R37 made every other field dead: the app reads them from Sablier, so the
    // indexer returning them would only invite a future caller to trust them.
    fetchMock.mockResolvedValue(ok({ streamIds: ["7", "3"] }));
    await expect(fetchHeldStreamIds(USER, BASE)).resolves.toEqual([7n, 3n]);
  });

  it("requests the owner lowercased, with the limit", async () => {
    fetchMock.mockResolvedValue(ok({ streamIds: [] }));
    await fetchHeldStreamIds(USER, BASE, 25);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/streams?owner=${USER.toLowerCase()}&limit=25`);
  });

  it("strips a legacy /sql suffix so an existing configured URL keeps working", async () => {
    // NEXT_PUBLIC_PONDER_URL historically pointed at the SQL mount; without
    // this every deployment would 404 on upgrade.
    fetchMock.mockResolvedValue(ok({ streamIds: [] }));
    await fetchHeldStreamIds(USER, `${BASE}/sql`);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/streams?owner=${USER.toLowerCase()}&limit=100`);
  });

  it("throws on an unconfigured indexer rather than reporting no streams", async () => {
    // Was: resolves to []. That is indistinguishable from "this user holds no
    // streams", so an unconfigured indexer rendered a confident empty list —
    // the exact reading R44 exists to prevent.
    await expect(fetchHeldStreamIds(USER, undefined)).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names rate limiting distinctly, since it is the one transient failure", async () => {
    fetchMock.mockResolvedValue(status(429));
    await expect(fetchHeldStreamIds(USER, BASE)).rejects.toThrow(/rate limited/i);
  });

  it("throws on any other error status", async () => {
    fetchMock.mockResolvedValue(status(500));
    await expect(fetchHeldStreamIds(USER, BASE)).rejects.toThrow(/failed \(500\)/);
  });
});

describe("fetchBorrowDemand", () => {
  it("parses events and coerces the numeric fields", async () => {
    fetchMock.mockResolvedValue(
      ok({ events: [{ aprBps: 1000, amount: "5", borrower: USER, blockTimestamp: "99" }] }),
    );
    await expect(fetchBorrowDemand(MARKET, 1_000n, BASE)).resolves.toEqual([
      { aprBps: 1000, amount: 5n, borrower: USER, blockTimestamp: 99n },
    ]);
  });

  it("asks only for the trailing demand window", async () => {
    fetchMock.mockResolvedValue(ok({ events: [] }));
    const now = 1_000_000n;
    await fetchBorrowDemand(MARKET, now, BASE);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`market=${MARKET.toLowerCase()}`);
    expect(url).toContain(`since=${(now - DEMAND_WINDOW_SECONDS).toString()}`);
  });

  it("throws on an unconfigured indexer instead of silently reporting zero demand", async () => {
    await expect(fetchBorrowDemand(MARKET, 1_000n, undefined)).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
