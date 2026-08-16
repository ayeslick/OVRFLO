import { type Address, type PublicClient } from "viem";
import { ovrfloFactoryAbi } from "./abis";
import { ZERO_ADDRESS } from "./config";
import { MAX_VAULT_REGISTRY_ENTRIES } from "./discovery/limits";
import type { VaultInfo } from "./types";

export type BootstrapFailureCode =
  | "no_code"
  | "wrong_chain"
  | "rpc_revert"
  | "budget_exceeded"
  | "block_skew";

export type BootstrapFailure = {
  code: BootstrapFailureCode;
  message: string;
};

export type ProtocolBootstrap =
  | { status: "loading" }
  | {
      status: "ready";
      factory: Address;
      stream: Address;
      vaults: readonly VaultInfo[];
      blockNumber: bigint;
    }
  | { status: "unavailable"; failures: readonly BootstrapFailure[] };

export type ReadyProtocolBootstrap = Extract<ProtocolBootstrap, { status: "ready" }>;

export type BootstrapClient = Pick<
  PublicClient,
  "getBytecode" | "getChainId" | "getBlock" | "multicall"
>;

function failure(code: BootstrapFailureCode, message: string): BootstrapFailure {
  return { code, message };
}

function unavailable(...failures: BootstrapFailure[]): Extract<ProtocolBootstrap, { status: "unavailable" }> {
  return { status: "unavailable", failures };
}

function isZero(address: Address | null | undefined): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Factory-rooted protocol discovery. Boot checks run before contract calls.
 * Two multicall passes pin to one block B; any item revert or mismatch fails closed.
 */
export async function discoverProtocolBootstrap(
  client: BootstrapClient,
  factory: Address,
  expectedChainId: number,
): Promise<Exclude<ProtocolBootstrap, { status: "loading" }>> {
  let bytecode: Hexish;
  let rpcChainId: number;
  try {
    [bytecode, rpcChainId] = await Promise.all([
      client.getBytecode({ address: factory }),
      client.getChainId(),
    ]);
  } catch (error) {
    return unavailable(
      failure("rpc_revert", error instanceof Error ? error.message : "Boot RPC failed"),
    );
  }

  if (!bytecode || bytecode === "0x") {
    return unavailable(failure("no_code", "Factory has no bytecode at the configured address"));
  }
  if (rpcChainId !== expectedChainId) {
    return unavailable(
      failure(
        "wrong_chain",
        `RPC chain id ${rpcChainId} does not match configured chain id ${expectedChainId}`,
      ),
    );
  }

  let blockNumber: bigint;
  let blockHash: `0x${string}` | null;
  try {
    const block = await client.getBlock({ blockTag: "latest" });
    if (!block.hash) {
      return unavailable(failure("block_skew", "Latest block has no hash"));
    }
    blockNumber = block.number;
    blockHash = block.hash;
  } catch (error) {
    return unavailable(
      failure("rpc_revert", error instanceof Error ? error.message : "getBlock failed"),
    );
  }

  let pass1: readonly MulticallItem[];
  try {
    pass1 = await client.multicall({
      allowFailure: true,
      blockNumber,
      contracts: [
        {
          address: factory,
          abi: ovrfloFactoryAbi,
          functionName: "ovrfloStream",
        },
        {
          address: factory,
          abi: ovrfloFactoryAbi,
          functionName: "ovrfloCount",
        },
      ],
    });
  } catch (error) {
    return unavailable(
      failure("rpc_revert", error instanceof Error ? error.message : "Pass-1 multicall failed"),
    );
  }

  const streamResult = pass1[0];
  const countResult = pass1[1];
  if (!streamResult || streamResult.status !== "success") {
    return unavailable(failure("rpc_revert", "ovrfloStream() reverted or failed"));
  }
  if (!countResult || countResult.status !== "success") {
    return unavailable(failure("rpc_revert", "ovrfloCount() reverted or failed"));
  }

  const stream = streamResult.result as Address;
  if (isZero(stream)) {
    return unavailable(failure("rpc_revert", "ovrfloStream() is unset"));
  }

  const count = countResult.result as bigint;
  if (count > BigInt(MAX_VAULT_REGISTRY_ENTRIES)) {
    return unavailable(
      failure(
        "budget_exceeded",
        `ovrfloCount ${count.toString()} exceeds registry budget ${MAX_VAULT_REGISTRY_ENTRIES}`,
      ),
    );
  }

  const n = Number(count);
  if (n === 0) {
    const skew = await assertBlockStable(client, blockNumber, blockHash);
    if (skew) return skew;
    return { status: "ready", factory, stream, vaults: [], blockNumber };
  }

  let vaultAddressResults: readonly MulticallItem[];
  try {
    vaultAddressResults = await client.multicall({
      allowFailure: true,
      blockNumber,
      contracts: Array.from({ length: n }, (_, index) => ({
        address: factory,
        abi: ovrfloFactoryAbi,
        functionName: "ovrflos" as const,
        args: [BigInt(index)] as const,
      })),
    });
  } catch (error) {
    return unavailable(
      failure("rpc_revert", error instanceof Error ? error.message : "ovrflos multicall failed"),
    );
  }

  if (vaultAddressResults.length !== n) {
    return unavailable(failure("rpc_revert", "ovrflos multicall length mismatch"));
  }

  const vaultAddresses: Address[] = [];
  for (let index = 0; index < n; index++) {
    const item = vaultAddressResults[index];
    if (!item || item.status !== "success") {
      return unavailable(failure("rpc_revert", `ovrflos(${index}) reverted or failed`));
    }
    const vault = item.result as Address;
    if (isZero(vault)) {
      return unavailable(failure("rpc_revert", `ovrflos(${index}) returned the zero address`));
    }
    vaultAddresses.push(vault);
  }

  let bindingResults: readonly MulticallItem[];
  try {
    bindingResults = await client.multicall({
      allowFailure: true,
      blockNumber,
      contracts: vaultAddresses.flatMap((vault) => [
        {
          address: factory,
          abi: ovrfloFactoryAbi,
          functionName: "ovrfloInfo" as const,
          args: [vault] as const,
        },
        {
          address: factory,
          abi: ovrfloFactoryAbi,
          functionName: "ovrfloToLending" as const,
          args: [vault] as const,
        },
      ]),
    });
  } catch (error) {
    return unavailable(
      failure(
        "rpc_revert",
        error instanceof Error ? error.message : "Vault binding multicall failed",
      ),
    );
  }

  if (bindingResults.length !== vaultAddresses.length * 2) {
    return unavailable(failure("rpc_revert", "Vault binding multicall length mismatch"));
  }

  const vaults: VaultInfo[] = [];
  for (let index = 0; index < vaultAddresses.length; index++) {
    const infoItem = bindingResults[index * 2];
    const lendingItem = bindingResults[index * 2 + 1];
    if (!infoItem || infoItem.status !== "success") {
      return unavailable(failure("rpc_revert", `ovrfloInfo reverted for vault index ${index}`));
    }
    if (!lendingItem || lendingItem.status !== "success") {
      return unavailable(
        failure("rpc_revert", `ovrfloToLending reverted for vault index ${index}`),
      );
    }
    const tuple = infoItem.result as readonly [Address, Address, Address];
    const lendingAddress = lendingItem.result as Address;
    vaults.push({
      vault: vaultAddresses[index]!,
      treasury: tuple[0],
      underlying: tuple[1],
      ovrfloToken: tuple[2],
      lending: isZero(lendingAddress) ? null : lendingAddress,
    });
  }

  const skew = await assertBlockStable(client, blockNumber, blockHash);
  if (skew) return skew;

  return { status: "ready", factory, stream, vaults, blockNumber };
}

async function assertBlockStable(
  client: BootstrapClient,
  blockNumber: bigint,
  expectedHash: `0x${string}`,
): Promise<Extract<ProtocolBootstrap, { status: "unavailable" }> | null> {
  try {
    const block = await client.getBlock({ blockNumber });
    if (!block.hash || !isAddressEqualableHash(block.hash, expectedHash)) {
      return unavailable(
        failure("block_skew", `Block ${blockNumber.toString()} hash changed during discovery`),
      );
    }
    return null;
  } catch (error) {
    return unavailable(
      failure("rpc_revert", error instanceof Error ? error.message : "Block re-read failed"),
    );
  }
}

function isAddressEqualableHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

type Hexish = `0x${string}` | undefined;

type MulticallItem =
  | { status: "success"; result: unknown }
  | { status: "failure"; error?: unknown };
