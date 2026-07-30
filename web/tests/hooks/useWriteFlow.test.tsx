import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Address, Hash } from "viem";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { clearTransactionExecutionRegistryForTests } from "@/hooks/useTransactionExecutor";
import { projectionKeys } from "@/lib/query-keys";
import { readyOutcome } from "@/lib/read-outcome";

const user = "0x0000000000000000000000000000000000000a11" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;
const vault = "0x0000000000000000000000000000000000000d44" as Address;
const ovrfloToken = "0x0000000000000000000000000000000000000e55" as Address;
const ptToken = "0x0000000000000000000000000000000000000f66" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const blockHash = `0x${"cd".repeat(32)}` as Hash;

const publicClient = {
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
  readContract: vi.fn(),
  getBytecode: vi.fn(),
};
const walletClient = { writeContract: vi.fn() };
const wagmiState = {
  address: user,
  chainId: 1,
};

vi.mock("wagmi", () => ({
  useConnection: () => ({
    addresses: [wagmiState.address],
    chainId: wagmiState.chainId,
    status: "connected",
  }),
  usePublicClient: () => publicClient,
  useWalletClient: () => ({ data: walletClient }),
  // Imported by useWriteFlow only to preserve its public generic call type.
  useWriteContract: vi.fn(),
}));

function createWrapper(projectionMarket = token) {
  const queryClient = new QueryClient();
  const projectionKey = projectionKeys.scope({
    chainId: 1,
    factoryAnchor: { number: 1n, hash: blockHash },
    lending,
    kind: "market-apr",
    market: projectionMarket,
    aprBps: 1_000,
  });
  queryClient.setQueryDefaults(projectionKey, {
    queryFn: async () =>
      readyOutcome(
        { ids: [1n] },
        { blockNumber: 101n, blockHash },
      ),
  });
  queryClient.setQueryData(
    projectionKey,
    readyOutcome(
      { ids: [1n] },
      { blockNumber: 101n, blockHash },
    ),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

async function submit(result: { current: ReturnType<typeof useWriteFlow> }) {
  act(() => {
    result.current.writeContract({
      address: lending,
      abi: [],
      functionName: "supplyLiquidity",
      args: [token, 1_000, 10n],
    } as never);
  });
  await vi.waitFor(() => expect(publicClient.waitForTransactionReceipt).toHaveBeenCalled());
}

describe("useWriteFlow executor adapter", () => {
  beforeEach(() => {
    clearTransactionExecutionRegistryForTests();
    wagmiState.address = user;
    wagmiState.chainId = 1;
    publicClient.simulateContract.mockReset();
    publicClient.waitForTransactionReceipt.mockReset();
    publicClient.getBlock.mockReset();
    publicClient.readContract.mockReset();
    publicClient.getBytecode.mockReset();
    walletClient.writeContract.mockReset();
    publicClient.simulateContract.mockImplementation(async (request) => ({
      request: { ...request, gas: 123n },
    }));
    walletClient.writeContract.mockResolvedValue(hash);
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      transactionHash: hash,
      status: "success",
      blockNumber: 100n,
      logs: [],
    });
    publicClient.getBlock.mockResolvedValue({
      number: 101n,
      hash: blockHash,
      timestamp: 50n,
    });
    publicClient.readContract.mockResolvedValue(0n);
    publicClient.getBytecode.mockResolvedValue("0x01");
  });

  it("simulates first and submits the returned request object unchanged", async () => {
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user, [token]), { wrapper });

    await submit(hook.result);

    const simulated = await publicClient.simulateContract.mock.results[0].value;
    expect(walletClient.writeContract).toHaveBeenCalledExactlyOnceWith(simulated.request);
    expect(walletClient.writeContract.mock.calls[0][0]).toBe(simulated.request);
    expect(simulated.request.chainId).toBe(1);
    await vi.waitFor(() => expect(hook.result.current.isConfirmed).toBe(true));
  });

  it("rebuilds a live market action through its U5 definition before simulation", async () => {
    publicClient.readContract.mockImplementation(async (request: { functionName: string }) => {
      switch (request.functionName) {
        case "balanceOf":
          return 100n;
        case "allowance":
          return 100n;
        case "aprMinBps":
          return 100;
        case "aprMaxBps":
          return 5_000;
        case "marketAprAvailableLiquidity":
          return 10n;
        default:
          return 0n;
      }
    });
    const marketScope = {
      vault,
      lending,
      market: token,
      underlying: token,
      ovrfloToken,
      ptToken,
      expiryCached: 1_000n,
    };
    const { wrapper } = createWrapper(token);
    const hook = renderHook(() => useWriteFlow(user, marketScope), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "supplyLiquidity",
        args: [token, 1_000, 10n],
      } as never);
    });

    await vi.waitFor(() => expect(hook.result.current.isConfirmed).toBe(true));
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "aprMinBps", blockNumber: 101n }),
    );
    expect(publicClient.getBlock).toHaveBeenCalledTimes(3);
    const simulated = await publicClient.simulateContract.mock.results[0].value;
    expect(walletClient.writeContract.mock.calls[0][0]).toBe(simulated.request);
  });

  it("overwrites a JavaScript caller's chain override before simulation", async () => {
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "withdrawLiquidity",
        args: [1n],
        chainId: 999,
      } as never);
    });
    await vi.waitFor(() => expect(publicClient.simulateContract).toHaveBeenCalled());

    expect(publicClient.simulateContract.mock.calls[0][0].chainId).toBe(1);
  });

  it("fails before snapshot loading or simulation when the wallet starts on another chain", async () => {
    wagmiState.chainId = 10;
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "withdrawLiquidity",
        args: [1n],
      } as never);
    });

    await vi.waitFor(() => expect(hook.result.current.hasFailed).toBe(true));
    expect(publicClient.getBlock).not.toHaveBeenCalled();
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("does not prompt the wallet after a simulation failure", async () => {
    publicClient.simulateContract.mockRejectedValue(
      new Error("execution reverted: stale route"),
    );
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "withdrawLiquidity",
        args: [1n],
      } as never);
    });

    await vi.waitFor(() => expect(hook.result.current.hasFailed).toBe(true));
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("treats a mined revert as failure and skips critical refresh", async () => {
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      transactionHash: hash,
      status: "reverted",
      blockNumber: 100n,
      logs: [],
    });
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    await submit(hook.result);

    await vi.waitFor(() => expect(hook.result.current.isReverted).toBe(true));
    expect(hook.result.current.isConfirmed).toBe(false);
    expect(publicClient.getBlock).not.toHaveBeenCalled();
  });

  it("preserves a successful hash when refresh fails and retries refresh without writing", async () => {
    publicClient.getBlock
      .mockRejectedValueOnce(new Error("head unavailable"))
      .mockResolvedValueOnce({ number: 101n, hash: blockHash });
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    await submit(hook.result);
    await vi.waitFor(() => expect(hook.result.current.refreshFailed).toBe(true));
    expect(hook.result.current.hash).toBe(hash);

    await act(async () => {
      await hook.result.current.retryRefresh();
    });
    expect(hook.result.current.isConfirmed).toBe(true);
    expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("stops before submission when account or chain changes after simulation", async () => {
    let releaseSimulation!: () => void;
    publicClient.simulateContract.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          releaseSimulation = () =>
            resolve({ request: { ...request, gas: 123n } });
        }),
    );
    const { wrapper } = createWrapper();
    const hook = renderHook(() => useWriteFlow(user), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "withdrawLiquidity",
        args: [1n],
      } as never);
    });

    await vi.waitFor(() => expect(publicClient.simulateContract).toHaveBeenCalledTimes(1));
    act(() => {
      wagmiState.chainId = 10;
      hook.rerender();
    });
    await act(async () => {
      releaseSimulation();
    });
    await vi.waitFor(() => expect(hook.result.current.hasFailed).toBe(true));
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("coalesces duplicate confirmation while the fresh snapshot is loading", async () => {
    publicClient.readContract.mockImplementation(async (request: { functionName: string }) => {
      switch (request.functionName) {
        case "balanceOf":
        case "allowance":
          return 100n;
        case "aprMinBps":
          return 100;
        case "aprMaxBps":
          return 5_000;
        default:
          return 0n;
      }
    });
    let release!: () => void;
    publicClient.getBlock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ number: 101n, hash: blockHash, timestamp: 50n });
          }),
      )
      .mockResolvedValue({ number: 101n, hash: blockHash, timestamp: 50n });
    const marketScope = {
      vault,
      lending,
      market: token,
      underlying: token,
      ovrfloToken,
      ptToken,
      expiryCached: 1_000n,
    };
    const { wrapper } = createWrapper(token);
    const hook = renderHook(() => useWriteFlow(user, marketScope), { wrapper });
    const request = {
      address: lending,
      abi: [],
      functionName: "supplyLiquidity",
      args: [token, 1_000, 10n],
    } as never;

    act(() => {
      hook.result.current.writeContract(request);
      hook.result.current.writeContract(request);
    });
    await vi.waitFor(() => expect(hook.result.current.isInFlight).toBe(true));
    await act(async () => release());
    await vi.waitFor(() => expect(hook.result.current.isConfirmed).toBe(true));

    expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for approval after identity changes during approval simulation", async () => {
    publicClient.readContract.mockImplementation(async (request: { functionName: string }) => {
      switch (request.functionName) {
        case "balanceOf":
          return 100n;
        case "allowance":
          return 0n;
        case "aprMinBps":
          return 100;
        case "aprMaxBps":
          return 5_000;
        default:
          return 0n;
      }
    });
    let releaseApprovalSimulation!: () => void;
    publicClient.simulateContract.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          releaseApprovalSimulation = () =>
            resolve({ request: { ...request, gas: 123n } });
        }),
    );
    const marketScope = {
      vault,
      lending,
      market: token,
      underlying: token,
      ovrfloToken,
      ptToken,
      expiryCached: 1_000n,
    };
    const { wrapper } = createWrapper(token);
    const hook = renderHook(() => useWriteFlow(user, marketScope), { wrapper });

    act(() => {
      hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "supplyLiquidity",
        args: [token, 1_000, 10n],
      } as never);
    });
    await vi.waitFor(() => expect(publicClient.simulateContract).toHaveBeenCalledTimes(1));
    act(() => {
      wagmiState.address = token;
      hook.rerender();
    });
    await act(async () => releaseApprovalSimulation());
    await vi.waitFor(() => expect(hook.result.current.hasFailed).toBe(true));

    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(hook.result.current.isConfirmed).toBe(false);
  });

  it("hands a changed fresh call back for review before a second confirmation", async () => {
    publicClient.readContract.mockImplementation(async (request: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      switch (request.functionName) {
        case "balanceOf":
        case "allowance":
          return 100n;
        case "marketDepositLimits":
          return 1_000n;
        case "marketTotalDeposited":
          return 0n;
        case "previewDeposit":
          return [request.args?.[1] as bigint, 0n, 0n, 1n];
        default:
          return 0n;
      }
    });
    const marketScope = {
      vault,
      lending,
      market: token,
      underlying: token,
      ovrfloToken,
      ptToken,
      expiryCached: 1_000n,
    };
    const { wrapper } = createWrapper(token);
    const hook = renderHook(() => useWriteFlow(user, marketScope), { wrapper });
    const staleRequest = {
      address: vault,
      abi: [],
      functionName: "deposit",
      args: [token, 10n, 0n],
    } as never;

    await act(async () => {
      await (hook.result.current.writeContract(staleRequest) as unknown as Promise<void>);
    });
    expect(hook.result.current.needsReview).toBe(true);
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(hook.result.current.review?.call.args).toEqual([token, 10n, 9n]);

    await act(async () => {
      await (hook.result.current.writeContract(staleRequest) as unknown as Promise<void>);
    });
    expect(hook.result.current.isConfirmed).toBe(true);

    expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it("falls back to zero-first after a mined nonzero-to-nonzero approval revert", async () => {
    let allowance = 1n;
    publicClient.readContract.mockImplementation(async (request: { functionName: string }) => {
      switch (request.functionName) {
        case "balanceOf":
          return 100n;
        case "allowance":
          return allowance;
        case "aprMinBps":
          return 100;
        case "aprMaxBps":
          return 5_000;
        default:
          return 0n;
      }
    });
    walletClient.writeContract
      .mockResolvedValueOnce(`0x${"01".repeat(32)}`)
      .mockResolvedValueOnce(`0x${"02".repeat(32)}`)
      .mockResolvedValueOnce(`0x${"03".repeat(32)}`)
      .mockResolvedValueOnce(hash);
    let receiptIndex = 0;
    publicClient.waitForTransactionReceipt.mockImplementation(async ({ hash: currentHash }) => {
      receiptIndex += 1;
      if (receiptIndex === 3) allowance = 100n;
      return {
        transactionHash: currentHash,
        status: receiptIndex === 1 ? "reverted" : "success",
        blockNumber: 100n,
        logs: [],
      };
    });
    const marketScope = {
      vault,
      lending,
      market: token,
      underlying: token,
      ovrfloToken,
      ptToken,
      expiryCached: 1_000n,
    };
    const { wrapper } = createWrapper(token);
    const hook = renderHook(() => useWriteFlow(user, marketScope), { wrapper });

    await act(async () => {
      await (hook.result.current.writeContract({
        address: lending,
        abi: [],
        functionName: "supplyLiquidity",
        args: [token, 1_000, 10n],
      } as never) as unknown as Promise<void>);
    });

    expect(hook.result.current.isConfirmed).toBe(true);
    expect(publicClient.simulateContract).toHaveBeenCalledTimes(4);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(4);
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(4);
  });
});
