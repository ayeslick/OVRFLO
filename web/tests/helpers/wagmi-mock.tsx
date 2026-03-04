import type {} from "react";


// Centralized wagmi mock factory for all test files.
// Provides configurable return values for hooks used throughout the app.

export interface MockReadContractsCall {
  contracts: unknown[];
  query?: unknown;
}

let readContractsImpl: (args: MockReadContractsCall) => unknown = () => ({
  data: undefined,
  isLoading: false,
});

export function setReadContractsMock(
  fn: (args: MockReadContractsCall) => unknown
) {
  readContractsImpl = fn;
}

let readContractImpl: (args: unknown) => unknown = () => ({
  data: undefined,
});

export function setReadContractMock(fn: (args: unknown) => unknown) {
  readContractImpl = fn;
}

let writeContractAsyncImpl: (args: unknown) => Promise<`0x${string}`> =
  async () => "0xmockhash" as `0x${string}`;

export function setWriteContractAsyncMock(
  fn: (args: unknown) => Promise<`0x${string}`>
) {
  writeContractAsyncImpl = fn;
}

let waitForReceiptImpl: () => {
  isSuccess: boolean;
  isError: boolean;
} = () => ({ isSuccess: false, isError: false });

export function setWaitForReceiptMock(
  fn: () => { isSuccess: boolean; isError: boolean }
) {
  waitForReceiptImpl = fn;
}

let accountImpl: () => {
  address?: `0x${string}`;
  chainId?: number;
} = () => ({});

export function setAccountMock(
  fn: () => { address?: `0x${string}`; chainId?: number }
) {
  accountImpl = fn;
}

let balanceImpl: () => unknown = () => ({ data: undefined });
export function setBalanceMock(fn: () => unknown) {
  balanceImpl = fn;
}

export function createWagmiMock() {
  return {
    useReadContracts: (args: MockReadContractsCall) => readContractsImpl(args),
    useReadContract: (args: unknown) => readContractImpl(args),
    useWriteContract: () => ({ writeContractAsync: writeContractAsyncImpl }),
    useWaitForTransactionReceipt: () => waitForReceiptImpl(),
    useAccount: () => accountImpl(),
    useBalance: () => balanceImpl(),
  };
}

export function resetAllMocks() {
  readContractsImpl = () => ({ data: undefined, isLoading: false });
  readContractImpl = () => ({ data: undefined });
  writeContractAsyncImpl = async () => "0xmockhash" as `0x${string}`;
  waitForReceiptImpl = () => ({ isSuccess: false, isError: false });
  accountImpl = () => ({});
  balanceImpl = () => ({ data: undefined });
}
