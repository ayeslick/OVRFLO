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
// Both claim kinds pay out in the market ovrfloToken.
const asset = "0x00000000000000000000000000000000000000cc" as Address;

const wagmiState = {
  writeContract: vi.fn(),
  hash: undefined as `0x${string}` | undefined,
  isPending: false,
  writeError: null as Error | null,
  receiptSuccess: false,
  receiptLoading: false,
  receiptError: null as Error | null,
  // Mined-but-reverted receipts resolve `isSuccess: true` with no JS error —
  // the on-chain outcome only shows up in `data.status`.
  receiptStatus: "success" as "success" | "reverted",
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
      wagmiState.receiptStatus = "success";
    }),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: wagmiState.receiptLoading,
    isSuccess: wagmiState.receiptSuccess,
    error: wagmiState.receiptError,
    data: wagmiState.receiptSuccess ? { status: wagmiState.receiptStatus } : undefined,
  }),
}));

const plan: QueuedTx[] = [
  { kind: "pool-claims", lending, loanIds: [1n, 2n], asset },
  { kind: "stream-claim", streamId: 7n, asset },
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

function revertCurrent(rerender: () => void, hash: `0x${string}`) {
  wagmiState.hash = hash;
  wagmiState.receiptStatus = "reverted";
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
  wagmiState.receiptStatus = "success";
});

describe("useTxQueue", () => {
  it("invalidates the payout token's reads, not only the contract it called", () => {
    // Every row in this queue pays the user an ERC-20 — ovrfloToken from
    // _claimFair, the stream's asset from withdrawMax — and that balance is read
    // against the token address, not the transaction's `to`. Scoping to `to`
    // alone left CLAIMABLE and the balance behind this modal showing pre-claim
    // numbers, which is the first thing a user checks after claiming.
    const queryClient = new QueryClient();
    const balanceKey = ["readContract", { address: asset, functionName: "balanceOf", args: [userA] }];
    queryClient.setQueryData(balanceKey, 1n);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(({ u }: { u?: Address }) => useTxQueue(u), {
      wrapper,
      initialProps: { u: userA },
    });

    act(() => result.current.start([{ kind: "pool-claims", lending, loanIds: [1n], asset }]));
    confirmCurrent(() => rerender({ u: userA }), "0xhash1");

    expect(queryClient.getQueryState(balanceKey)?.isInvalidated).toBe(true);
  });

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
    const fresh: QueuedTx[] = [{ kind: "stream-claim", streamId: 7n, asset }];
    act(() => result.current.resume(fresh));
    expect(result.current.rows[0].status).toBe("confirmed");
    expect(result.current.rows).toHaveLength(2);
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(3);
  });

  it("treats a mined-but-reverted receipt as a failure, not a confirmation", () => {
    // Regression: waitForTransactionReceipt resolves isSuccess/isError based on
    // whether the RPC fetch itself succeeded, not the transaction's on-chain
    // outcome — a reverted tx (e.g. claiming an already-claimed stream) still
    // mines a receipt with no write/receipt error, only `data.status`.
    const { result, rerender, invalidateSpy } = setup();
    act(() => result.current.start([{ kind: "stream-claim", streamId: 7n, asset }]));
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);

    revertCurrent(() => rerender({ u: userA }), "0xhash1");

    expect(result.current.rows[0].status).toBe("failed");
    expect(result.current.failed).toBe(true);
    expect(result.current.running).toBe(false);
    expect(result.current.done).toBe(false);
    // No further advance and no invalidation for the reverted tx.
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
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

// R42/M-7: the pause effect and the receipt-advance effect run in the same
// commit when a receipt lands on the render where `user` changed, and the
// advance effect's closure still holds the pre-update `paused === false`. It
// therefore fired the next transaction at the NEW signer — a wallet prompt the
// user never initiated, for the previous account's stream. It fails closed
// on-chain (Sablier rejects a non-recipient), but the prompt is the harm.
describe("useTxQueue — signer switch cannot be beaten (R42)", () => {
  it("does not advance when the receipt and the signer change land together", () => {
    const { result, rerender } = setup();
    act(() => result.current.start(plan));
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);

    // The commit that both confirms tx 1 and switches the signer — the exact
    // interleaving that used to slip a second transaction through.
    wagmiState.hash = "0xhash1";
    wagmiState.receiptSuccess = true;
    act(() => rerender({ u: userB }));

    expect(result.current.rows[0].status).toBe("confirmed");
    // The second transaction must NOT have been dispatched.
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(1);
    expect(result.current.running).toBe(false);
    expect(result.current.paused).toBe(true);
  });

  it("still advances normally while the signer is unchanged", () => {
    // Guard against over-correction: the ref check must only stop the queue on
    // an actual signer change, not on every confirmation.
    const { result, rerender } = setup();
    act(() => result.current.start(plan));

    confirmCurrent(() => rerender({ u: userA }), "0xhash1");

    expect(result.current.rows[0].status).toBe("confirmed");
    expect(wagmiState.writeContract).toHaveBeenCalledTimes(2);
  });

  it("re-owns the queue for the new signer on an explicit resume", () => {
    // Resuming after a switch is the user's deliberate act, unlike auto-advance.
    const { result, rerender } = setup();
    act(() => result.current.start(plan));
    act(() => rerender({ u: userB }));

    wagmiState.hash = "0xhash1";
    wagmiState.receiptSuccess = true;
    act(() => rerender({ u: userB }));
    const beforeResume = wagmiState.writeContract.mock.calls.length;

    wagmiState.receiptSuccess = false;
    wagmiState.hash = undefined;
    act(() => result.current.resume([plan[1]]));

    expect(wagmiState.writeContract.mock.calls.length).toBe(beforeResume + 1);
  });
});
