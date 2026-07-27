import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ReactNode } from "react";
import type { QueuedTx } from "@/lib/claim-all";
import { useTxQueue } from "@/hooks/useTxQueue";

const userA = "0x0000000000000000000000000000000000000a11" as Address;
const userB = "0x0000000000000000000000000000000000000b22" as Address;
const lending = "0x00000000000000000000000000000000000000aa" as Address;

const wagmiState = {
  writeContract: vi.fn(),
  hash: undefined as `0x${string}` | undefined,
  isPending: false,
  writeError: null as Error | null,
  receiptSuccess: false,
  receiptLoading: false,
  receiptError: null as Error | null,
};

vi.mock("wagmi", () => ({
  useWriteContract: () => ({
    writeContract: wagmiState.writeContract,
    data: wagmiState.hash,
    isPending: wagmiState.isPending,
    error: wagmiState.writeError,
    reset: vi.fn(() => {
      wagmiState.hash = undefined;
      wagmiState.writeError = null;
      wagmiState.receiptSuccess = false;
    }),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: wagmiState.receiptLoading,
    isSuccess: wagmiState.receiptSuccess,
    error: wagmiState.receiptError,
  }),
}));

const plan: QueuedTx[] = [
  { kind: "pool-claims", lending, loanIds: [1n, 2n] },
  { kind: "stream-claim", streamId: 7n },
];

function setup(user: Address | undefined = userA) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ u }: { u?: Address }) => useTxQueue(u), {
    wrapper,
    initialProps: { u: user },
  });
  return { ...hook, invalidateSpy };
}

function confirmCurrent(rerender: () => void, hash: `0x${string}`) {
  wagmiState.hash = hash;
  wagmiState.receiptSuccess = true;
  act(() => rerender());
}

beforeEach(() => {
  wagmiState.writeContract = vi.fn();
  wagmiState.hash = undefined;
  wagmiState.isPending = false;
  wagmiState.writeError = null;
  wagmiState.receiptSuccess = false;
  wagmiState.receiptLoading = false;
  wagmiState.receiptError = null;
});

describe("useTxQueue", () => {
  it("does not sign anything until start is called", () => {
    setup();
    expect(wagmiState.writeContract).not.toHaveBeenCalled();
  });

  it("executes sequentially, advancing only per confirmed receipt, invalidating each time", () => {
    const { result, rerender, invalidateSpy } = setup();
    act(() => result.current.start(plan));
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);
    expect(wagmiState.writeContract.mock.calls[0][0]).toMatchObject({ functionName: "multicall", address: lending });

    confirmCurrent(() => rerender({ u: userA }), "0xhash1");
    expect(result.current.rows[0].status).toBe("confirmed");
    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(2);
    expect(wagmiState.writeContract.mock.calls[1][0]).toMatchObject({ functionName: "withdrawMax" });

    confirmCurrent(() => rerender({ u: userA }), "0xhash2");
    expect(result.current.done).toBe(true);
    expect(result.current.running).toBe(false);
  });

  it("stops on failure and resumes from a fresh plan keeping confirmed rows", () => {
    const { result, rerender } = setup();
    act(() => result.current.start(plan));
    confirmCurrent(() => rerender({ u: userA }), "0xhash1");
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(2);

    wagmiState.writeError = new Error("user rejected");
    act(() => rerender({ u: userA }));
    expect(result.current.failed).toBe(true);
    expect(result.current.running).toBe(false);
    expect(result.current.rows[1].status).toBe("failed");

    // Resume with a fresh plan (stream now partially claimed elsewhere -> new plan)
    wagmiState.writeError = null;
    const fresh: QueuedTx[] = [{ kind: "stream-claim", streamId: 7n }];
    act(() => result.current.resume(fresh));
    expect(result.current.rows[0].status).toBe("confirmed");
    expect(result.current.rows).toHaveLength(2);
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(3);
  });

  it("pauses after the in-flight tx when the connected wallet changes", () => {
    const { result, rerender } = setup();
    act(() => result.current.start(plan));

    act(() => rerender({ u: userB }));
    expect(result.current.paused).toBe(true);

    confirmCurrent(() => rerender({ u: userB }), "0xhash1");
    // first tx confirmed, but no auto-advance to the second
    expect(result.current.rows[0].status).toBe("confirmed");
    expect(result.current.running).toBe(false);
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);
  });
});
