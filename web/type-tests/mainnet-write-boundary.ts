import type { Address } from "viem";
import { erc20Abi } from "@/lib/abis";
import { useWriteFlow } from "@/hooks/useWriteFlow";

declare const token: Address;
declare const spender: Address;
declare const flow: ReturnType<typeof useWriteFlow>;

flow.writeContract({
  address: token,
  abi: erc20Abi,
  functionName: "approve",
  args: [spender, 1n],
});

flow.writeContract({
  address: token,
  abi: erc20Abi,
  functionName: "approve",
  args: [spender, 1n],
  // @ts-expect-error U1/R4: callers cannot supply a chain id; the wrapper injects mainnet.
  chainId: 999,
});
