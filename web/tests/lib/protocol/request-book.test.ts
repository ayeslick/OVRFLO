import { describe, expect, it } from "vitest";
import type { Address, Hash } from "viem";
import {
  loadFactoryRequestBookPage,
  loadRequestBookPage,
  type RequestBookReadClient,
} from "@/lib/protocol/request-book";

const FACTORY = "0x0000000000000000000000000000000000000f00" as Address;
const BOOK = "0x0000000000000000000000000000000000000b00" as Address;
const BOOK_B = "0x0000000000000000000000000000000000000b01" as Address;
const LENDING = "0x0000000000000000000000000000000000000a11" as Address;
const LENDING_B = "0x0000000000000000000000000000000000000a12" as Address;
const USER = "0x0000000000000000000000000000000000000c33" as Address;
const OTHER = "0x0000000000000000000000000000000000000d44" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const EOA = "0x0000000000000000000000000000000000000e0a" as Address;
const PIN = {
  blockNumber: 11n,
  blockHash: `0x${"ab".repeat(32)}` as Hash,
};
const BYTECODE = "0x6000";

function resting(borrower: Address, streamId: bigint) {
  return [borrower, LENDING, 500, 10n, 9n, streamId] as const;
}

function bookClient(
  readContract: (args: {
    address?: Address;
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }) => Promise<unknown>,
  code: (address: Address) => string | undefined = () => BYTECODE,
): RequestBookReadClient {
  return {
    readContract,
    async getCode({ address }: { address: Address }) {
      return code(address) as `0x${string}` | undefined;
    },
  } as unknown as RequestBookReadClient;
}

describe("loadRequestBookPage", () => {
  it("reads this wallet's list past id 500", async () => {
    const client = bookClient(async ({ functionName, args }) => {
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") {
        expect(args?.[1]).toBe(0n);
        return 612n;
      }
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadRequestBookPage(client, BOOK, LENDING, USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests).toEqual([
      {
        requestId: 612n,
        book: BOOK,
        lending: LENDING,
        borrower: USER,
        market: LENDING,
        aprBps: 500,
        targetBorrow: 10n,
        minAcceptable: 9n,
        streamId: 9n,
      },
    ]);
  });

  it("drops a listed id whose requests row is no longer this wallet", async () => {
    const client = bookClient(async ({ functionName }) => {
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") return 3n;
      if (functionName === "requests") return resting(OTHER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadRequestBookPage(client, BOOK, LENDING, USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.requests).toEqual([]);
    expect(outcome.data.sourceCount).toBe(1n);
  });

  it("returns partial when one listed row fails to hydrate", async () => {
    const client = bookClient(async ({ functionName, args }) => {
      if (functionName === "requestCount") return 2n;
      if (functionName === "requestAt") return ((args?.[1] as bigint) ?? 0n) + 1n;
      if (functionName === "requests" && args?.[0] === 2n) throw new Error("requests reverted");
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadRequestBookPage(client, BOOK, LENDING, USER, 0n, 25n);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.data.requests).toHaveLength(1);
    expect(outcome.data.requests[0]?.requestId).toBe(1n);
  });

  it("forwards the pin to requestAt", async () => {
    const client = bookClient(async (args) => {
      if (args.functionName === "requestCount") {
        expect(args.blockNumber).toBe(11n);
        return 1n;
      }
      if (args.functionName === "requestAt") {
        expect(args.blockNumber).toBe(11n);
        return 612n;
      }
      if (args.functionName === "requests") return resting(USER, 9n);
      throw new Error(args.functionName);
    });

    const outcome = await loadRequestBookPage(client, BOOK, LENDING, USER, 0n, 25n, {
      pin: PIN,
      pinMode: "number",
    });
    expect(outcome.status).toBe("ready");
  });
});

describe("loadFactoryRequestBookPage", () => {
  it("pages a prior book when the current router is zero", async () => {
    const client = bookClient(async ({ address, functionName, args }) => {
      if (functionName === "router") return ZERO;
      if (functionName === "priorRouterCount") return 1n;
      if (functionName === "priorRouterAt") {
        expect(args?.[1]).toBe(0n);
        return BOOK;
      }
      if (functionName === "lending") return LENDING;
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") return 612n;
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests[0]?.book).toBe(BOOK);
    expect(outcome.data.requests[0]?.lending).toBe(LENDING);
  });

  it("lists a book once when it is both current and prior", async () => {
    const client = bookClient(async ({ functionName }) => {
      if (functionName === "router") return BOOK;
      if (functionName === "priorRouterCount") return 1n;
      if (functionName === "priorRouterAt") return BOOK;
      if (functionName === "lending") return LENDING;
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") return 7n;
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests).toHaveLength(1);
  });

  it("lists a shared book once across two lendings", async () => {
    const client = bookClient(async ({ functionName }) => {
      if (functionName === "router") return BOOK;
      if (functionName === "priorRouterCount") return 0n;
      if (functionName === "lending") return LENDING;
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") return 4n;
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING, LENDING_B], USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests[0]?.lending).toBe(LENDING);
  });

  it("returns unavailable when priorRouterAt reverts", async () => {
    const client = bookClient(async ({ functionName }) => {
      if (functionName === "router") return BOOK_B;
      if (functionName === "priorRouterCount") return 1n;
      if (functionName === "priorRouterAt") throw new Error("priorRouterAt reverted");
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("unavailable");
  });

  it("skips a zero router that has no prior books", async () => {
    const retired = "0x0000000000000000000000000000000000000e55" as Address;
    const client = bookClient(async ({ address, functionName }) => {
      if (functionName === "router") {
        return address === retired ? ZERO : BOOK;
      }
      if (functionName === "priorRouterCount") return 0n;
      if (functionName === "lending") return LENDING;
      if (functionName === "requestCount") return 1n;
      if (functionName === "requestAt") return 612n;
      if (functionName === "requests") return resting(USER, 9n);
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [retired, LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests.map((row) => row.requestId)).toEqual([612n]);
  });

  it("skips an EOA router and still pages the live book", async () => {
    const client = bookClient(
      async ({ address, functionName }) => {
        if (functionName === "router") return address === LENDING ? EOA : BOOK;
        if (functionName === "priorRouterCount") return 0n;
        if (functionName === "lending") return LENDING_B;
        if (functionName === "requestCount") return 1n;
        if (functionName === "requestAt") return 8n;
        if (functionName === "requests") return resting(USER, 9n);
        throw new Error(functionName);
      },
      (address) => (address === EOA ? "0x" : BYTECODE),
    );

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING, LENDING_B], USER, 0n, 25n);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.sourceCount).toBe(1n);
    expect(outcome.data.requests[0]?.book).toBe(BOOK);
  });

  it("returns unavailable when a live book fails lending()", async () => {
    const client = bookClient(async ({ functionName }) => {
      if (functionName === "router") return BOOK;
      if (functionName === "priorRouterCount") return 0n;
      if (functionName === "lending") throw new Error("lending reverted");
      throw new Error(functionName);
    });

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("unavailable");
  });

  it("returns unavailable when getCode fails", async () => {
    const client = {
      async readContract({ functionName }: { functionName: string }) {
        if (functionName === "router") return BOOK;
        if (functionName === "priorRouterCount") return 0n;
        throw new Error(functionName);
      },
      async getCode() {
        throw new Error("getCode failed");
      },
    } as unknown as RequestBookReadClient;

    const outcome = await loadFactoryRequestBookPage(client, FACTORY, [LENDING], USER, 0n, 25n);
    expect(outcome.status).toBe("unavailable");
  });
});
