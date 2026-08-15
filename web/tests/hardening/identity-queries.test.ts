import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { removeIdentityQueries, queryTouchesIdentity } from "@/lib/invalidate";
import { borrowerBookKeys, lenderBookKeys } from "@/lib/query-keys";

const USER_A = "0x1234567890abcdef1234567890abcdef12345678" as const;
const USER_B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
const LENDING = "0x1111111111111111111111111111111111111111" as const;

describe("identity query purge", () => {
  it("matches account-keyed custom factories and address-bearing wagmi keys", () => {
    expect(
      queryTouchesIdentity(lenderBookKeys.account(1, LENDING, USER_A), {
        account: USER_A.toLowerCase(),
      }),
    ).toBe(true);
    expect(
      queryTouchesIdentity(borrowerBookKeys.account(1, LENDING, USER_B), {
        account: USER_A.toLowerCase(),
      }),
    ).toBe(false);
    expect(
      queryTouchesIdentity(["readContract", { address: USER_A }], { account: USER_A.toLowerCase() }),
    ).toBe(true);
  });

  it("removes only the departed account's cache entries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(lenderBookKeys.account(1, LENDING, USER_A), { positions: [] });
    queryClient.setQueryData(lenderBookKeys.account(1, LENDING, USER_B), {
      positions: [{ id: 2n }],
    });
    removeIdentityQueries(queryClient, { account: USER_A });
    expect(queryClient.getQueryData(lenderBookKeys.account(1, LENDING, USER_A))).toBeUndefined();
    expect(queryClient.getQueryData(lenderBookKeys.account(1, LENDING, USER_B))).toEqual({
      positions: [{ id: 2n }],
    });
  });
});
