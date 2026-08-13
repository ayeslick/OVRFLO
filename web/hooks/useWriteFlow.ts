"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConnection,
  usePublicClient,
  useWalletClient,
  useWriteContract,
} from "wagmi";
import { decodeFunctionData, isAddressEqual, type Address, type Log } from "viem";
import { useTransactionExecutor } from "./useTransactionExecutor";
import {
  type ActionExecutionDraft,
  type ActionExecutionRuntime,
  type ExactSimulationRequest,
  type ExecutionPlan,
  sameActionIdentity,
} from "@/lib/action-runtime";
import type {
  ActionIdentity,
  ContractKind,
  ReadyAction,
  TouchedResource,
} from "@/lib/actions/types";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import {
  chainId as configuredChainId,
  SABLIER_LOCKUP_ADDRESS,
} from "@/lib/config";
import { buildRefreshPlan, refreshQueryResources } from "@/lib/query-resource-registry";
import { invalidateTouchedResources, marketContracts } from "@/lib/invalidate";
import { isRevertFailure, userFacingError } from "@/lib/errors";
import { RECEIPT_CONFIRMATIONS } from "@/lib/receipts";
import type { ActionType, MarketInfo } from "@/lib/types";
import {
  createLiveExecutionPlan,
  type LiveMarketScope,
} from "@/lib/live-action-plan";

/**
 * Form-facing adapter for the single transaction executor.
 *
 * Market-scoped domain calls are rebuilt through their U5 action definitions
 * from one pinned block. The raw compatibility path remains only for explicit
 * approval transactions and non-market test/type seams; it owns no receipt,
 * refresh, or terminal lifecycle.
 */
export function useWriteFlow(
  user?: Address,
  scope: Pick<
    MarketInfo,
    | "vault"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > | readonly Address[] = EMPTY,
) {
  const queryClient = useQueryClient();
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: configuredChainId });
  const wallet = useWalletClient({ chainId: configuredChainId });
  const identityRef = useRef<ActionIdentity | null>(null);
  identityRef.current =
    (connection.addresses?.[0] ?? user) && connection.chainId !== undefined
      ? {
          account: (connection.addresses?.[0] ?? user)!,
          chainId: connection.chainId,
        }
      : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const preparationRef = useRef<Promise<void> | null>(null);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const preparationGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const pendingReviewRef = useRef<{
    fingerprint: string;
    plan: ExecutionPlan;
  } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationGenerationRef.current += 1;
      preparationAbortRef.current?.abort(
        new DOMException("Action preparation cancelled", "AbortError"),
      );
      preparationAbortRef.current = null;
      pendingReviewRef.current = null;
    };
  }, []);

  const runtime = useMemo<ActionExecutionRuntime>(
    () => ({
      getIdentity: async () => identityRef.current,
      authorize: async (authorization, identity) => {
        if (!publicClient) throw new Error("Public client is unavailable");
        if (!wallet.data) throw new Error("Wallet client is unavailable");

        const send = async (
          address: Address,
          abi: typeof erc20Abi | typeof sablierLockupAbi,
          args: readonly [Address, bigint],
        ) => {
          const simulated = await publicClient.simulateContract({
            address,
            abi,
            functionName: "approve",
            args,
            account: identity.account,
            chainId: configuredChainId,
          } as never);
          if (!sameActionIdentity(identity, identityRef.current)) {
            throw new Error("Wallet identity changed during authorization simulation");
          }
          const hash = await wallet.data.writeContract(simulated.request as never);
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            confirmations: RECEIPT_CONFIRMATIONS,
          });
          return {
            transactionHash: receipt.transactionHash,
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            logs: receipt.logs as readonly Log[],
          } as const;
        };

        if (authorization.kind === "erc721") {
          return send(
            authorization.token,
            sablierLockupAbi,
            [authorization.spender, authorization.tokenId],
          );
        }

        const canClearFirst =
          authorization.currentAllowance > 0n &&
          authorization.approvalAmount > 0n;
        try {
          const direct = await send(
            authorization.token,
            erc20Abi,
            [authorization.spender, authorization.approvalAmount],
          );
          if (direct.status === "success" || !canClearFirst) return direct;
        } catch (error) {
          if (!canClearFirst || !isRevertFailure(error)) throw error;
        }
        const cleared = await send(
          authorization.token,
          erc20Abi,
          [authorization.spender, 0n],
        );
        if (cleared.status !== "success") return cleared;
        return send(
          authorization.token,
          erc20Abi,
          [authorization.spender, authorization.approvalAmount],
        );
      },
      simulate: async (request, identity) => {
        if (!publicClient) throw new Error("Public client is unavailable");
        const simulated = await publicClient.simulateContract({
          ...(request as Record<string, unknown>),
          account: identity.account,
          chainId: configuredChainId,
        } as never);
        return { request: simulated.request as unknown as ExactSimulationRequest };
      },
      submit: async (request) => {
        if (!wallet.data) throw new Error("Wallet client is unavailable");
        return wallet.data.writeContract(request as never);
      },
      waitForReceipt: async (hash) => {
        if (!publicClient) throw new Error("Public client is unavailable");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: RECEIPT_CONFIRMATIONS,
          onReplaced: ({ transactionReceipt }) => transactionReceipt,
        });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          logs: receipt.logs as readonly Log[],
        };
      },
      refresh: async (resources, identity, receipt) => {
        if (!publicClient) throw new Error("Public client is unavailable");
        invalidateTouchedResources(queryClient, resources, identity);
        const plan = buildRefreshPlan(resources, identity);
        await refreshQueryResources(queryClient, plan, {
          captureHead: async () => {
            const block = await publicClient.getBlock({ blockTag: "latest" });
            if (!block.hash) throw new Error("Post-receipt head has no block hash");
            if (block.number < receipt.blockNumber) {
              throw new Error("Post-receipt head precedes the successful receipt");
            }
            return { number: block.number, hash: block.hash };
          },
          hydrate: async (resource, head) => {
            const blockNumber = head.number;
            switch (resource.kind) {
              case "contract": {
                const code = await publicClient.getBytecode({
                  address: resource.address,
                  blockNumber,
                });
                if (!code) throw new Error(`Critical contract hydration failed for ${resource.address}`);
                return;
              }
              case "market":
                await publicClient.readContract({
                  address: resource.vault,
                  abi: ovrfloAbi,
                  functionName: "marketTotalDeposited",
                  args: [resource.market],
                  blockNumber,
                });
                return;
              case "market-depth":
                await publicClient.readContract({
                  address: resource.lending,
                  abi: ovrfloLendingAbi,
                  functionName: resource.aprBps === undefined
                    ? "marketAvailableLiquidity"
                    : "marketAprAvailableLiquidity",
                  args: resource.aprBps === undefined
                    ? [resource.market]
                    : [resource.market, resource.aprBps],
                  blockNumber,
                } as never);
                return;
              case "liquidity-position":
                await publicClient.readContract({
                  address: resource.lending,
                  abi: ovrfloLendingAbi,
                  functionName: "positionState",
                  args: [resource.id],
                  blockNumber,
                });
                return;
              case "loan":
                await publicClient.readContract({
                  address: resource.lending,
                  abi: ovrfloLendingAbi,
                  functionName: "loans",
                  args: [resource.id],
                  blockNumber,
                });
                return;
              case "stream":
                await publicClient.readContract({
                  address: resource.sablier,
                  abi: sablierLockupAbi,
                  functionName: "withdrawableAmountOf",
                  args: [resource.id],
                  blockNumber,
                });
                return;
              case "nft-approval":
                await publicClient.readContract({
                  address: resource.token,
                  abi: sablierLockupAbi,
                  functionName: "getApproved",
                  args: [resource.tokenId],
                  blockNumber,
                });
                return;
              case "token-balance":
                await publicClient.readContract({
                  address: resource.token,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [resource.account],
                  blockNumber,
                });
                return;
              case "allowance":
                await publicClient.readContract({
                  address: resource.token,
                  abi: erc20Abi,
                  functionName: "allowance",
                  args: [resource.owner, resource.spender],
                  blockNumber,
                });
            }
          },
        });
      },
    }),
    [publicClient, queryClient, wallet.data],
  );
  const executor = useTransactionExecutor(runtime);
  const resetExecutor = executor.reset;
  const reset = useCallback(() => {
    preparationGenerationRef.current += 1;
    preparationAbortRef.current?.abort(
      new DOMException("Action preparation cancelled", "AbortError"),
    );
    preparationAbortRef.current = null;
    preparationRef.current = null;
    pendingReviewRef.current = null;
    if (mountedRef.current) setIsPreparing(false);
    resetExecutor();
  }, [resetExecutor]);
  const receipt = useMemo(
    () =>
      executor.receipt
        ? { ...executor.receipt, logs: [...(executor.receipt.logs ?? [])] as Log[] }
        : undefined,
    [executor.receipt],
  );

  const writeContract = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (args: any, _options: any) => {
      const identity = identityRef.current;
      if (!identity) return;
      if (identity.chainId !== configuredChainId) {
        executor.report({ status: "identity_changed" });
        return;
      }
      if (publicClient && isMarketScope(scopeRef.current)) {
        if (preparationRef.current) return;
        const fingerprint = writeFingerprint(args);
        const pendingReview = pendingReviewRef.current;
        if (pendingReview?.fingerprint === fingerprint) {
          pendingReviewRef.current = null;
          const reviewed = await executor.confirm(pendingReview.plan);
          if (reviewed.status === "needs_review") {
            pendingReviewRef.current = {
              fingerprint,
              plan: { ...pendingReview.plan, accepted: reviewed.draft },
            };
          }
          return;
        }
        pendingReviewRef.current = null;
        let handled = false;
        const generation = preparationGenerationRef.current + 1;
        preparationGenerationRef.current = generation;
        const preparationAbort = new AbortController();
        preparationAbortRef.current = preparationAbort;
        const isCurrentPreparation = () =>
          mountedRef.current &&
          preparationGenerationRef.current === generation &&
          !preparationAbort.signal.aborted;
        const prepareAndExecute = (async () => {
          if (isCurrentPreparation()) setIsPreparing(true);
          try {
            const prepared = await createLiveExecutionPlan(
              args,
              identity,
              scopeRef.current as LiveMarketScope,
              publicClient,
            );
            if (!isCurrentPreparation()) {
              handled = true;
              return;
            }
            if (prepared) {
              handled = true;
              if (prepared.status === "ready") {
                const result = await executor.confirm(prepared.plan);
                if (!isCurrentPreparation()) return;
                if (result.status === "needs_review") {
                  pendingReviewRef.current = {
                    fingerprint,
                    plan: { ...prepared.plan, accepted: result.draft },
                  };
                }
              } else if (prepared.status === "needs_review") {
                pendingReviewRef.current = {
                  fingerprint,
                  plan: prepared.plan,
                };
                executor.report({
                  status: "needs_review",
                  draft: prepared.draft,
                });
              } else {
                executor.report(prepared);
              }
              return;
            }
          } catch (error) {
            handled = true;
            if (!isCurrentPreparation()) return;
            executor.report({ status: "transport_failed", error });
            return;
          } finally {
            if (isCurrentPreparation()) setIsPreparing(false);
          }
        })();
        preparationRef.current = prepareAndExecute.finally(() => {
          if (preparationGenerationRef.current === generation) {
            preparationRef.current = null;
            preparationAbortRef.current = null;
          }
        });
        await preparationRef.current;
        if (handled || !isCurrentPreparation()) return;
      }
      const request = {
        ...args,
        account: identity.account,
        // Runtime enforcement wins over a JavaScript caller that bypasses the
        // compile-time `chainId?: never` boundary.
        chainId: configuredChainId,
      } as ExactSimulationRequest;
      const action = legacyReadyAction(args, identity, scopeRef.current);
      const accepted: ActionExecutionDraft = { action, request };
      const plan: ExecutionPlan = {
        flowId: `${action.type}:${action.call.functionName}`,
        accepted,
        // The compatibility path is limited to explicit approval transactions
        // and non-market seams. Every market-scoped domain call returned above
        // uses a pinned, definition-backed rebuild.
        rebuild: async (currentIdentity) =>
          sameActionIdentity(identity, currentIdentity)
            ? { status: "ready", draft: accepted }
            : {
                status: "invalid",
                errors: [
                  {
                    code: "action-snapshot-mismatch",
                    message: "Wallet identity changed before execution",
                  },
                ],
              },
      };
      void executor.confirm(plan);
    }) as MainnetWriteContract,
    [executor, publicClient],
  );

  return {
    writeContract,
    reset,
    hash: executor.receipt?.transactionHash ?? executor.hash,
    receipt,
    isSigning: executor.isSigning,
    isConfirming: executor.isConfirming,
    isRefreshing: executor.isRefreshing,
    isInFlight: isPreparing || executor.isInFlight,
    isConfirmed: executor.isConfirmed,
    isReverted: executor.isReverted,
    refreshFailed: executor.refreshFailed,
    needsReview: executor.needsReview,
    confirmPlan: executor.confirm,
    review:
      executor.result?.status === "needs_review"
        ? executor.result.draft.action.review
        : null,
    retryRefresh: executor.retryRefresh,
    error: surfaceExecutorError(executor.error),
    hasFailed: executor.hasFailed,
  };
}

function surfaceExecutorError(error: unknown): Error | null {
  if (!error) return null;
  if (isRevertFailure(error)) return new Error(userFacingError(error));
  return error instanceof Error ? error : new Error(String(error));
}

function actionTypeFor(functionName: string): ActionType {
  switch (functionName) {
    case "supply":
      return "supply";
    case "withdraw":
      return "withdraw";
    case "deposit":
      return "deposit";
    case "claim":
      return "claim_matured";
    case "wrap":
      return "wrap";
    case "unwrap":
      return "unwrap";
    case "borrow":
      return "borrow";
    case "withdrawMax":
      return "claim_stream";
    case "multicall":
      return "adjust_rate";
    case "repay":
      return "repay";
    case "close":
      return "close";
    default:
      // ERC-20/ERC-721 approval requests use the same executor transport but
      // are not themselves a reviewed domain action.
      return "supply";
  }
}

function contractKindFor(functionName: string): ContractKind {
  if (functionName === "approve") return "erc20";
  if (functionName === "withdrawMax") return "sablier";
  if (["deposit", "claim", "wrap", "unwrap"].includes(functionName)) return "ovrflo";
  return "lending";
}

function legacyReadyAction(
  args: {
    address?: Address;
    functionName?: string;
    args?: readonly unknown[];
    value?: bigint;
  },
  identity: ActionIdentity,
  scope: Pick<
    MarketInfo,
    | "vault"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > | readonly Address[],
): ReadyAction {
  if (!args.address || !args.functionName) {
    throw new Error("A contract address and function name are required");
  }
  const call = {
    target: args.address,
    contract: contractKindFor(args.functionName),
    functionName: args.functionName,
    args: args.args ?? [],
    value: args.value ?? 0n,
  };
  const touchedResources = legacyTouchedResources(args, identity, scope);
  const type = actionTypeFor(args.functionName);
  return {
    type,
    identity,
    preconditions: ["legacy-adapter"],
    authorizations: [],
    call,
    touchedResources,
    review: {
      actionType: type,
      title: args.functionName,
      identity,
      call,
      authorizations: [],
      economics: {},
    },
    receiptSummary: {
      source: args.address,
      eventName: null,
      label: args.functionName,
      expectedIds: [],
      expectedAmounts: {},
    },
  };
}

function legacyTouchedResources(
  args: {
    address?: Address;
    functionName?: string;
    args?: readonly unknown[];
  },
  identity: ActionIdentity,
  scope: Pick<
    MarketInfo,
    | "vault"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > | readonly Address[],
): TouchedResource[] {
  if (!args.address || !args.functionName) return [];
  const market = isMarketScope(scope) ? scope : null;
  const contracts: readonly Address[] = market
    ? marketContracts(market)
    : (scope as readonly Address[]);
  const resources: TouchedResource[] = [];
  const callArgs = args.args ?? [];

  switch (args.functionName) {
    case "approve": {
      const spender = callArgs[0] as Address | undefined;
      const amountOrId = callArgs[1] as bigint | undefined;
      if (!spender || amountOrId === undefined) break;
      if (isAddressEqual(args.address, SABLIER_LOCKUP_ADDRESS)) {
        resources.push({
          kind: "nft-approval",
          token: args.address,
          owner: identity.account,
          spender,
          tokenId: amountOrId,
        });
      } else {
        resources.push({
          kind: "allowance",
          token: args.address,
          owner: identity.account,
          spender,
        });
      }
      break;
    }
    case "supply":
      if (callArgs[0] && typeof callArgs[1] === "number") {
        resources.push({
          kind: "market-depth",
          lending: args.address,
          market: callArgs[0] as Address,
          aprBps: callArgs[1],
        });
      }
      if (market) {
        resources.push(
          { kind: "token-balance", token: market.underlying, account: identity.account },
          {
            kind: "allowance",
            token: market.underlying,
            owner: identity.account,
            spender: args.address,
          },
        );
      }
      break;
    case "withdraw":
      if (typeof callArgs[0] === "bigint") {
        resources.push({
          kind: "liquidity-position",
          lending: args.address,
          id: callArgs[0],
        });
      }
      if (market) {
        resources.push({
          kind: "token-balance",
          token: market.underlying,
          account: identity.account,
        });
      }
      break;
    case "claim":
      if (typeof callArgs[0] === "bigint") {
        resources.push({ kind: "loan", lending: args.address, id: callArgs[0] });
      }
      if (market) {
        resources.push(
          { kind: "market", vault: args.address, market: market.market },
          { kind: "token-balance", token: market.ovrfloToken, account: identity.account },
          { kind: "token-balance", token: market.ptToken, account: identity.account },
          { kind: "token-balance", token: market.underlying, account: identity.account },
        );
      }
      break;
    case "deposit":
      if (market) {
        resources.push(
          { kind: "market", vault: args.address, market: market.market },
          { kind: "token-balance", token: market.underlying, account: identity.account },
          { kind: "token-balance", token: market.ovrfloToken, account: identity.account },
          {
            kind: "allowance",
            token: market.underlying,
            owner: identity.account,
            spender: args.address,
          },
        );
      }
      break;
    case "wrap":
      if (market) {
        resources.push(
          { kind: "market", vault: args.address, market: market.market },
          { kind: "token-balance", token: market.underlying, account: identity.account },
          { kind: "token-balance", token: market.ovrfloToken, account: identity.account },
          {
            kind: "allowance",
            token: market.underlying,
            owner: identity.account,
            spender: args.address,
          },
        );
      }
      break;
    case "unwrap":
      if (market) {
        resources.push(
          { kind: "market", vault: args.address, market: market.market },
          { kind: "token-balance", token: market.underlying, account: identity.account },
          { kind: "token-balance", token: market.ovrfloToken, account: identity.account },
        );
      }
      break;
    case "borrow": {
      if (market) {
        resources.push({ kind: "market-depth", lending: args.address, market: market.market });
      }
      if (typeof callArgs[3] === "bigint") {
        resources.push({
          kind: "stream",
          sablier: SABLIER_LOCKUP_ADDRESS,
          id: callArgs[3],
        });
        resources.push({
          kind: "nft-approval",
          token: SABLIER_LOCKUP_ADDRESS,
          owner: identity.account,
          spender: args.address,
          tokenId: callArgs[3],
        });
      }
      break;
    }
    case "withdrawMax":
      if (typeof callArgs[0] === "bigint") {
        resources.push({ kind: "stream", sablier: args.address, id: callArgs[0] });
      }
      if (market) {
        resources.push({
          kind: "token-balance",
          token: market.underlying,
          account: identity.account,
        });
      }
      break;
    case "multicall":
      for (const encoded of Array.isArray(callArgs[0]) ? callArgs[0] : []) {
        if (typeof encoded !== "string") continue;
        try {
          const decoded = decodeFunctionData({ abi: ovrfloLendingAbi, data: encoded as `0x${string}` });
          if (decoded.functionName === "withdraw") {
            resources.push({
              kind: "liquidity-position",
              lending: args.address,
              id: decoded.args[0],
            });
          } else if (decoded.functionName === "supply") {
            resources.push({
              kind: "market-depth",
              lending: args.address,
              market: decoded.args[0],
              aprBps: decoded.args[1],
            });
          }
        } catch {
          // Known lending children receive projection scopes. Unknown children
          // fall through to the direct lending refresh below.
        }
      }
      resources.push({ kind: "contract", address: args.address });
      if (market) {
        resources.push({
          kind: "allowance",
          token: market.underlying,
          owner: identity.account,
          spender: args.address,
        });
      }
      break;
    case "repay":
      if (typeof callArgs[0] === "bigint") {
        resources.push({ kind: "loan", lending: args.address, id: callArgs[0] });
      }
      if (market) {
        resources.push(
          { kind: "token-balance", token: market.ovrfloToken, account: identity.account },
          {
            kind: "allowance",
            token: market.ovrfloToken,
            owner: identity.account,
            spender: args.address,
          },
        );
      }
      break;
    case "close":
      if (typeof callArgs[0] === "bigint") {
        resources.push({ kind: "loan", lending: args.address, id: callArgs[0] });
      }
      resources.push({ kind: "contract", address: SABLIER_LOCKUP_ADDRESS });
      break;
    default:
      resources.push(
        ...[...new Set([args.address, ...contracts].map((address) => address.toLowerCase()))]
          .map((address) => ({ kind: "contract" as const, address: address as Address })),
      );
      break;
  }
  return resources;
}

function isMarketScope(
  scope: Pick<
    MarketInfo,
    | "vault"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > | readonly Address[],
): scope is Pick<
    MarketInfo,
    | "vault"
    | "lending"
    | "market"
    | "underlying"
    | "ovrfloToken"
    | "ptToken"
    | "expiryCached"
  > {
  return !Array.isArray(scope);
}

const EMPTY: readonly Address[] = [];

type WagmiWriteContract = ReturnType<typeof useWriteContract>["writeContract"];
type WagmiWriteArgs = Parameters<WagmiWriteContract>[0];
type WagmiWriteOptions = Parameters<WagmiWriteContract>[1];
type MainnetWriteContract = (
  args: Omit<WagmiWriteArgs, "chainId"> & { chainId?: never },
  options?: WagmiWriteOptions,
) => ReturnType<WagmiWriteContract>;

function writeFingerprint(args: unknown): string {
  return JSON.stringify(args, (_key, value) =>
    typeof value === "bigint" ? `${value}n` : value,
  );
}
