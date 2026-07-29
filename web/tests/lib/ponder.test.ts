import { beforeEach, describe, expect, it, vi } from "vitest";

// createPonderClient/fetchHeldStreamIds/fetchBorrowDemand default their
// baseUrl param to the ambient `ponderUrl` from lib/config — so passing
// `undefined` explicitly is NOT the same as "no argument", it just re-derives
// the same ambient value. Pinning ponderUrl to undefined here makes every
// "unconfigured indexer" test deterministic regardless of the real .env
// (bootstrap:local's write-env.sh sets NEXT_PUBLIC_PONDER_URL, which would
// otherwise silently turn these into "configured indexer" tests).
vi.mock("@/lib/config", () => ({ ponderUrl: undefined }));

const { execute, createClient } = vi.hoisted(() => ({
  execute: vi.fn(),
  createClient: vi.fn((_url: string) => ({ db: { execute } })),
}));

vi.mock("@ponder/client", () => ({
  createClient: (url: string) => createClient(url),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

import { createPonderClient, fetchBorrowDemand, fetchHeldStreamIds } from "@/lib/ponder";
import { DEMAND_WINDOW_SECONDS } from "@/lib/demand";

const USER = "0x1234567890abcdef1234567890abcdef12345678" as const;
const MARKET = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPonderClient", () => {
  it("returns null for an empty/undefined base URL instead of constructing a client", () => {
    expect(createPonderClient(undefined)).toBeNull();
    expect(createPonderClient("")).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("strips a trailing slash before handing the URL to the underlying client", () => {
    createPonderClient("http://localhost:42069/sql/");
    expect(createClient).toHaveBeenLastCalledWith("http://localhost:42069/sql");
  });

  it("passes a URL with no trailing slash through unchanged", () => {
    createPonderClient("http://localhost:42069/sql");
    expect(createClient).toHaveBeenLastCalledWith("http://localhost:42069/sql");
  });
});

describe("null-base-URL handling differs by call: collapse vs surface", () => {
  it("fetchHeldStreamIds throws on an unconfigured indexer rather than reporting no streams", async () => {
    // Was: resolves to []. That is indistinguishable from "this user holds no
    // streams", so an unconfigured indexer rendered a confident empty list —
    // the exact reading R44 exists to prevent. The caller has to be able to
    // tell "none" from "cannot tell".
    await expect(fetchHeldStreamIds(USER, undefined)).rejects.toThrow(/not configured/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("fetchBorrowDemand throws on an unconfigured indexer instead of silently reporting zero demand", async () => {
    await expect(fetchBorrowDemand(MARKET, 1_000n, undefined)).rejects.toThrow(/not configured/i);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("fetchHeldStreamIds row mapping", () => {
  it("maps the raw ponder row into a HeldStream, lower-cases the recipient for the query, and defaults withdrawable to 0", async () => {
    execute.mockResolvedValue([
      {
        stream_id: "42",
        recipient: USER,
        sender: "0x00000000000000000000000000000000000009",
        asset: "0x0000000000000000000000000000000000000a",
        end_time: "1900000000",
        canceled: false,
        depleted: false,
        deposit_amount: "1000000000000000000",
        withdrawn_amount: "250000000000000000",
      },
    ]);

    const streams = await fetchHeldStreamIds(USER, "http://localhost:42069/sql");

    expect(streams).toEqual([
      {
        streamId: 42n,
        recipient: USER,
        sender: "0x00000000000000000000000000000000000009",
        asset: "0x0000000000000000000000000000000000000a",
        endTime: 1_900_000_000n,
        canceled: false,
        depleted: false,
        deposited: 1_000_000_000_000_000_000n,
        withdrawn: 250_000_000_000_000_000n,
        withdrawable: 0n,
      },
    ]);

    const query = execute.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toContain(USER.toLowerCase());
  });
});

describe("fetchBorrowDemand row mapping and cutoff", () => {
  it("maps the raw ponder row into a BorrowDemandEvent and queries with the lower-cased market and the trailing-window cutoff", async () => {
    execute.mockResolvedValue([
      { apr_bps: 1000, amount: "500000000000000000", borrower: USER, block_timestamp: "1900000500" },
    ]);
    const nowSeconds = 1_900_000_500n;

    const events = await fetchBorrowDemand(MARKET, nowSeconds, "http://localhost:42069/sql");

    expect(events).toEqual([
      { aprBps: 1000, amount: 500_000_000_000_000_000n, borrower: USER, blockTimestamp: 1_900_000_500n },
    ]);

    const query = execute.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toContain(MARKET.toLowerCase());
    expect(query.values).toContain((nowSeconds - DEMAND_WINDOW_SECONDS).toString());
  });
});
