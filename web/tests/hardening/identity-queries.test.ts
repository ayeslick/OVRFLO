import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { queryTouchesIdentity, removeIdentityQueries } from "@/lib/invalidate";
import { borrowerBookKeys, lenderBookKeys, streamKeys } from "@/lib/query-keys";

const USER_A = "0x0000000000000000000000000000000000000a11" as Address;
const USER_B = "0x0000000000000000000000000000000000000b22" as Address;

describe("identity query wipe", () => {
  it("matches address-keyed and chain-keyed factory keys", () => {
    expect(queryTouchesIdentity(streamKeys.held(USER_A), { account: USER_A.toLowerCase() })).toBe(true);
    expect(queryTouchesIdentity(streamKeys.held(USER_B), { account: USER_A.toLowerCase() })).toBe(false);
    expect(queryTouchesIdentity(lenderBookKeys.account(1, USER_A, USER_A), { chainId: 1 })).toBe(true);
    expect(queryTouchesIdentity(borrowerBookKeys.account(1, USER_A, USER_A), { chainId: 2 })).toBe(false);
  });

  it("removes the previous account's entities so they cannot render", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(streamKeys.truth(1, USER_A), { streams: [{ streamId: 1n }] });
    queryClient.setQueryData(streamKeys.truth(1, USER_B), { streams: [{ streamId: 2n }] });
    queryClient.setQueryData(lenderBookKeys.account(1, USER_A, USER_A), { positions: [1] });
    const spy = vi.spyOn(queryClient, "removeQueries");
    removeIdentityQueries(queryClient, { account: USER_A });
    expect(spy).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(streamKeys.truth(1, USER_A))).toBeUndefined();
    expect(queryClient.getQueryData(streamKeys.truth(1, USER_B))).toEqual({ streams: [{ streamId: 2n }] });
  });
});
