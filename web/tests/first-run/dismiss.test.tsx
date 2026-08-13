import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { chainId } from "@/lib/config";
import {
  firstRunDismissKey,
  useFirstRunDismissed,
} from "@/components/first-run/dismiss";

const WALLET_A = "0x00000000000000000000000000000000000000a1" as Address;
const WALLET_B = "0x00000000000000000000000000000000000000b2" as Address;

describe("first-run dismiss persistence", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(firstRunDismissKey(chainId, WALLET_A));
      window.localStorage.removeItem(firstRunDismissKey(chainId, WALLET_B));
    } catch {
      // ignore
    }
  });

  it("starts guided and persists skip per wallet", async () => {
    const first = renderHook(() => useFirstRunDismissed(WALLET_A));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(first.result.current.dismissed).toBe(false);
    act(() => first.result.current.dismiss());
    expect(first.result.current.dismissed).toBe(true);
    expect(window.localStorage.getItem(firstRunDismissKey(chainId, WALLET_A))).toBe("1");

    const again = renderHook(() => useFirstRunDismissed(WALLET_A));
    await waitFor(() => expect(again.result.current.dismissed).toBe(true));

    const other = renderHook(() => useFirstRunDismissed(WALLET_B));
    await waitFor(() => expect(other.result.current.ready).toBe(true));
    expect(other.result.current.dismissed).toBe(false);
  });
});
