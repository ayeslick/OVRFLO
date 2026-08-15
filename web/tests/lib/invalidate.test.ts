import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import {
  invalidateAllOnChainReads,
  invalidateOnChainReads,
  invalidateTouchedResources,
  marketContracts,
} from "@/lib/invalidate";
import { borrowerBookKeys, lenderBookKeys } from "@/lib/query-keys";

const user = "0x0000000000000000000000000000000000000a11" as Address;

describe("invalidateAllOnChainReads", () => {
  it("invalidates exactly the two wagmi roots", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAllOnChainReads(queryClient, user);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContract"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContracts"] });
  });
});

// R39: invalidation used to prefix-match the two wagmi roots, so a write to one
// market refetched every other market's ladder, balances and loan book. These
// assert the scoping actually scopes — a predicate matching everything would
// pass a weaker "was called" check just as well.
describe("invalidateOnChainReads (R39)", () => {
  const MARKET_A = "0x00000000000000000000000000000000000000AA" as Address;
  const MARKET_B = "0x00000000000000000000000000000000000000bb" as Address;

  type Predicate = (q: { queryKey: unknown[] }) => boolean;

  function predicatesFrom(spy: { mock: { calls: unknown[][] } }): Predicate[] {
    return spy.mock.calls
      .map((call) => (call[0] as { predicate?: Predicate }).predicate)
      .filter((p): p is Predicate => typeof p === "function");
  }
  const matchesAny = (preds: Predicate[], queryKey: unknown[]) => preds.some((p) => p({ queryKey }));

  it("invalidates a read whose key names a touched contract", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(true);
  });

  it("leaves an unrelated market's reads alone", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_B }])).toBe(false);
  });

  it("matches case-insensitively, since address casing is not normalised", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A.toLowerCase() as Address] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(true);
  });

  it("invalidates a batched read containing any touched contract", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    const batch = ["readContracts", { contracts: [{ address: MARKET_B }, { address: MARKET_A }] }];
    expect(matchesAny(predicatesFrom(spy), batch)).toBe(true);
  });

  it("survives a bigint in the key, which JSON cannot serialise by default", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A] });
    const key = ["readContract", { address: MARKET_A, args: [123n] }];
    expect(() => matchesAny(predicatesFrom(spy), key)).not.toThrow();
    expect(matchesAny(predicatesFrom(spy), key)).toBe(true);
  });

  it("matches nothing when no contract was recorded, rather than everything", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [] });
    expect(matchesAny(predicatesFrom(spy), ["readContract", { address: MARKET_A }])).toBe(false);
  });

  it("adds the stream lockup when streams:true so held reads refresh", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateOnChainReads(client, { contracts: [MARKET_A], user, streams: true });
    expect(
      matchesAny(predicatesFrom(spy), ["readContract", { address: SABLIER_LOCKUP_ADDRESS }]),
    ).toBe(true);
  });
});

describe("marketContracts", () => {
  it("names the tokens a write moves, not just the contract it is addressed to", () => {
    const market = {
      vault: "0x0000000000000000000000000000000000000001" as Address,
      lending: "0x0000000000000000000000000000000000000002" as Address,
      underlying: "0x0000000000000000000000000000000000000003" as Address,
      ovrfloToken: "0x0000000000000000000000000000000000000004" as Address,
      ptToken: "0x0000000000000000000000000000000000000005" as Address,
    };
    expect(marketContracts(market)).toEqual([
      market.vault,
      market.lending,
      market.underlying,
      market.ovrfloToken,
      market.ptToken,
      SABLIER_LOCKUP_ADDRESS,
    ]);
  });

  it("drops a market with no lending deployment rather than emitting a null", () => {
    const contracts = marketContracts({
      vault: "0x0000000000000000000000000000000000000001" as Address,
      lending: null,
      underlying: "0x0000000000000000000000000000000000000003" as Address,
      ovrfloToken: "0x0000000000000000000000000000000000000004" as Address,
      ptToken: "0x0000000000000000000000000000000000000005" as Address,
    });
    expect(contracts).not.toContain(null);
    expect(contracts).toHaveLength(5);
  });
});

describe("invalidateTouchedResources", () => {
  const lending = "0x00000000000000000000000000000000000000aa" as Address;
  const vault = "0x00000000000000000000000000000000000000bb" as Address;
  const identity = { account: user, chainId: 1 };

  type Predicate = (q: { queryKey: unknown[] }) => boolean;
  function predicatesFrom(spy: { mock: { calls: unknown[][] } }): Predicate[] {
    return spy.mock.calls
      .map((call) => (call[0] as { predicate?: Predicate }).predicate)
      .filter((p): p is Predicate => typeof p === "function");
  }
  const matchesAny = (preds: Predicate[], queryKey: unknown[]) => preds.some((p) => p({ queryKey }));

  it("invalidates lender-book keys after supply/withdraw (market-depth / liquidity-position)", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateTouchedResources(client, [
      { kind: "market-depth", lending, market: vault, aprBps: 1000 },
    ]);
    expect(spy).toHaveBeenCalledWith({ queryKey: lenderBookKeys.all });
    expect(spy.mock.calls).not.toContainEqual([{ queryKey: borrowerBookKeys.all }]);
  });

  it("invalidates both books after repay/close (loan)", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateTouchedResources(client, [{ kind: "loan", lending, id: 1n }]);
    expect(spy).toHaveBeenCalledWith({ queryKey: borrowerBookKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: lenderBookKeys.all });
  });

  it("invalidates wagmi reads naming the stream lockup after stream resources", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateTouchedResources(
      client,
      [{ kind: "stream", sablier: SABLIER_LOCKUP_ADDRESS, id: 9n }],
      identity,
    );
    expect(
      matchesAny(predicatesFrom(spy), ["readContract", { address: SABLIER_LOCKUP_ADDRESS }]),
    ).toBe(true);
  });

  it("does not widen to the stream lockup for a supply that never touched a stream", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateTouchedResources(
      client,
      [{ kind: "token-balance", token: vault, account: user }],
      identity,
    );
    expect(
      matchesAny(predicatesFrom(spy), ["readContract", { address: SABLIER_LOCKUP_ADDRESS }]),
    ).toBe(false);
  });
});
