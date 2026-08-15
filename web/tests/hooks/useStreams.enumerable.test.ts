import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useStreams, renderEligibleStream, borrowRouteEligibleStream } from "@/hooks/useStreams";
import { MAX_ENUMERATION_IDS, MIN_STREAM_AMOUNT } from "@/lib/lending-math";
import { READ_INTERVAL_MS } from "@/lib/query-keys";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;
const VAULT = "0x00000000000000000000000000000000000000b2" as Address;
const TOKEN = "0x00000000000000000000000000000000000000c3" as Address;
const OTHER = "0x00000000000000000000000000000000000000d4" as Address;
const MARKET = "0x00000000000000000000000000000000000000e5" as Address;

const { LOCKUP } = vi.hoisted(() => ({
  LOCKUP: "0x0000000000000000000000000000000000000f66" as Address,
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    SABLIER_LOCKUP_ADDRESS: LOCKUP,
    isConfiguredAddress: (address: Address | null | undefined) =>
      Boolean(address && address !== "0x0000000000000000000000000000000000000000"),
  };
});

const success = (result: unknown) => ({ status: "success" as const, result });
const failure = (error: unknown) => ({ status: "failure" as const, error });

type ReadReturn = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  dataUpdatedAt: number;
};

let balanceReturn: ReadReturn;
let idsReturn: ReadReturn;
let stateReturn: {
  data?: unknown[];
  isLoading: boolean;
  dataUpdatedAt: number;
};
const readContractConfigs: unknown[] = [];
const readContractsConfigs: unknown[] = [];

vi.mock("wagmi", () => ({
  useReadContract: (config: { functionName?: string }) => {
    readContractConfigs.push(config);
    if (config.functionName === "balanceOf") return balanceReturn;
    if (config.functionName === "tokensOfOwnerIn") return idsReturn;
    return balanceReturn;
  },
  useReadContracts: (config: unknown) => {
    readContractsConfigs.push(config);
    return stateReturn;
  },
}));

function streamTuple(overrides: Partial<{
  sender: Address;
  asset: Address;
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  isDepleted: boolean;
  startTime: number;
  endTime: number;
  cliffTime: number;
  isCancelable: boolean;
}> = {}) {
  return {
    sender: overrides.sender ?? VAULT,
    startTime: overrides.startTime ?? 1_000,
    cliffTime: overrides.cliffTime ?? 1_000,
    isCancelable: overrides.isCancelable ?? false,
    wasCanceled: false,
    asset: overrides.asset ?? TOKEN,
    endTime: overrides.endTime ?? 2_000,
    isDepleted: overrides.isDepleted ?? false,
    isStream: true,
    isTransferable: true,
    amounts: {
      deposited: overrides.deposited ?? MIN_STREAM_AMOUNT * 2n,
      withdrawn: overrides.withdrawn ?? 0n,
      refunded: overrides.refunded ?? 0n,
    },
  };
}

function stateRow(streamId: bigint, owner: Address = ACCOUNT, tuple = streamTuple()) {
  return [
    success(owner),
    success(tuple),
    success(1n),
    success(1),
  ];
}

const input = {
  account: ACCOUNT,
  vaults: [{ vault: VAULT, ovrfloToken: TOKEN }],
  markets: [{ vault: VAULT, market: MARKET, ovrfloToken: TOKEN, expiryCached: 2_000n }],
  registryComplete: true,
  now: 1_500n,
};

describe("useStreams Enumerable discovery", () => {
  beforeEach(() => {
    readContractConfigs.length = 0;
    readContractsConfigs.length = 0;
    balanceReturn = {
      data: 1n,
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      dataUpdatedAt: 1_000,
    };
    idsReturn = {
      data: [5n],
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      dataUpdatedAt: 1_000,
    };
    stateReturn = {
      data: stateRow(5n).flat(),
      isLoading: false,
      dataUpdatedAt: 1_000,
    };
  });

  it("hydrates all ids in one state batch with READ_INTERVAL_MS", () => {
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(1);
    expect(result.current.data.streams[0]?.streamId).toBe(5n);
    expect(result.current.metadata.dataUpdatedAt).toBe(1_000);

    const stateConfig = readContractsConfigs.at(-1) as {
      query: { refetchInterval: number; enabled: boolean };
      contracts: unknown[];
    };
    expect(stateConfig.query.refetchInterval).toBe(READ_INTERVAL_MS);
    expect(stateConfig.contracts).toHaveLength(4);

    const balanceConfig = readContractConfigs.find(
      (c) => (c as { functionName?: string }).functionName === "balanceOf",
    ) as { query: { refetchInterval: number; enabled: boolean } };
    expect(balanceConfig.query.refetchInterval).toBe(READ_INTERVAL_MS);
    expect(balanceConfig.query.enabled).toBe(true);
  });

  it("hides empty streams from the lens", () => {
    stateReturn.data = stateRow(
      5n,
      ACCOUNT,
      streamTuple({ deposited: MIN_STREAM_AMOUNT * 2n, withdrawn: MIN_STREAM_AMOUNT * 2n }),
    ).flat();
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(0);
  });

  it("excludes streams whose sender is not a registered vault", () => {
    stateReturn.data = stateRow(5n, ACCOUNT, streamTuple({ sender: OTHER })).flat();
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(0);
  });

  it("flips unavailable when balanceOf exceeds MAX_ENUMERATION_IDS", () => {
    balanceReturn.data = MAX_ENUMERATION_IDS + 1n;
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("unavailable");
  });

  it("returns ready-empty for zero balance", () => {
    balanceReturn.data = 0n;
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toEqual([]);
  });

  it("does not fire reads when the wallet is disconnected", () => {
    const { result } = renderHook(() =>
      useStreams({ ...input, account: null }),
    );
    expect(result.current.status).toBe("loading");
    const enabled = readContractConfigs.map(
      (c) => (c as { query?: { enabled?: boolean } }).query?.enabled,
    );
    expect(enabled.every((value) => value === false)).toBe(true);
  });

  it("drops a burned id failure and keeps the book rendered", () => {
    balanceReturn.data = 2n;
    idsReturn.data = [5n, 6n];
    stateReturn.data = [
      ...stateRow(5n).flat(),
      failure(new Error("notNull")),
      failure(new Error("notNull")),
      failure(new Error("notNull")),
      failure(new Error("notNull")),
    ];
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams.map((row) => row.streamId)).toEqual([5n]);
  });

  it("drops a stream owned by the market (pledged)", () => {
    stateReturn.data = stateRow(5n, MARKET).flat();
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(0);
  });

  it("marks the book unavailable on id-batch RPC failure", () => {
    idsReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error("rpc down"),
      dataUpdatedAt: 0,
    };
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("unavailable");
  });

  it("keeps the book when balance shrinks between stages (fewer ids)", () => {
    balanceReturn.data = 2n;
    idsReturn.data = [5n];
    stateReturn.data = stateRow(5n).flat();
    const { result } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toHaveLength(1);
  });

  it("rerenders when mock returns change (SC18)", () => {
    const { result, rerender } = renderHook(() => useStreams(input));
    expect(result.current.status).toBe("ready");

    balanceReturn.data = 0n;
    idsReturn.data = [];
    stateReturn.data = [];
    rerender();
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.streams).toEqual([]);
  });

  it("keeps stream ids as bigint in detail-view args", () => {
    const { result } = renderHook(() => useStreams(input));
    if (result.current.status !== "ready") throw new Error("expected ready");
    const id = result.current.data.streams[0]!.streamId;
    expect(typeof id).toBe("bigint");
    const stateConfig = readContractsConfigs.at(-1) as {
      contracts: { args: readonly unknown[] }[];
    };
    expect(stateConfig.contracts.every((c) => typeof c.args[0] === "bigint")).toBe(true);
  });
});

describe("stream eligibility predicates", () => {
  const vaults = [{ vault: VAULT, ovrfloToken: TOKEN }];
  const schedule = {
    start: 1_000n,
    end: 2_000n,
    deposited: MIN_STREAM_AMOUNT * 2n,
    withdrawn: 0n,
    refunded: 0n,
    cliffTime: 1_000n,
    isCancelable: false,
  };

  it("render predicate keeps vault+asset streams including matured markets", () => {
    expect(
      renderEligibleStream({ sender: VAULT, asset: TOKEN, vaults }).eligible,
    ).toBe(true);
    expect(
      renderEligibleStream({ sender: OTHER, asset: TOKEN, vaults }).eligible,
    ).toBe(false);
    expect(
      renderEligibleStream({ sender: VAULT, asset: OTHER, vaults }).eligible,
    ).toBe(false);
  });

  it("borrow-route predicate drops SeriesMatured and dust remaining", () => {
    const markets = [{ vault: VAULT, market: MARKET, ovrfloToken: TOKEN, expiryCached: 2_000n }];
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT * 2n,
        now: 1_500n,
        vaults,
        markets,
      }).eligible,
    ).toBe(true);
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT * 2n,
        now: 2_000n,
        vaults,
        markets,
      }).eligible,
    ).toBe(false);
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT - 1n,
        now: 1_500n,
        vaults,
        markets,
      }).eligible,
    ).toBe(false);
  });
});
