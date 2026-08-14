"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContracts } from "wagmi";
import { isAddressEqual, type Address } from "viem";
import { sablierLockupAbi } from "@/lib/abis";
import {
  chainId,
  factoryDeployment,
  isConfiguredAddress,
  runtimeProfile,
  SABLIER_LOCKUP_ADDRESS,
} from "@/lib/config";
import {
  captureHeadSnapshot,
  createViemDiscoveryClient,
  scanLogs,
} from "@/lib/discovery/log-scanner";
import {
  decodeDepositedOrigin,
  decodeRecipientTransfer,
  depositedTopics,
  discoverStreamCandidates,
  recipientTransferTopics,
} from "@/lib/discovery/stream-discovery";
import { canStartBrowserDiscovery } from "@/lib/browser-runtime";
import { MIN_STREAM_AMOUNT } from "@/lib/lending-math";
import { readQuery, streamKeys } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import {
  readCheckpoint,
  scanCheckpointKey,
  streamCandidatesKey,
  writeCandidateIdsUnion,
  writeCheckpointMax,
} from "@/lib/storage";
import type { MarketInfo, VaultInfo } from "@/lib/types";

const SCAN_RANGE = 2_000n;
const CANDIDATE_LIMIT = 256;

export type StreamScheduleParams = {
  start: bigint;
  end: bigint;
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  cliffTime: bigint;
  isCancelable: boolean;
};

export type HydratedStream = {
  streamId: bigint;
  owner: Address;
  sender: Address;
  asset: Address;
  schedule: StreamScheduleParams;
  withdrawable: bigint;
  remaining: bigint;
  /** Streams lens: vault sender + ovrflo asset. Matured markets stay visible. */
  renderEligible: boolean;
  /** Borrow route: full requireEligible including SeriesMatured + MIN_STREAM_AMOUNT. */
  borrowRouteEligible: boolean;
  vault: Address | null;
  market: Address | null;
};

export type StreamBook = {
  candidates: readonly bigint[];
  streams: readonly HydratedStream[];
};

export type StreamMarket = Pick<
  MarketInfo,
  "vault" | "market" | "ovrfloToken" | "expiryCached"
>;

export function renderEligibleStream(input: {
  sender: Address;
  asset: Address;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
}): { eligible: boolean; vault: Address | null } {
  for (const vault of input.vaults) {
    if (
      isAddressEqual(input.sender, vault.vault) &&
      isAddressEqual(input.asset, vault.ovrfloToken)
    ) {
      return { eligible: true, vault: vault.vault };
    }
  }
  return { eligible: false, vault: null };
}

export function borrowRouteEligibleStream(input: {
  sender: Address;
  asset: Address;
  schedule: StreamScheduleParams;
  remaining: bigint;
  now: bigint;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
}): { eligible: boolean; market: Address | null } {
  const identity = renderEligibleStream(input);
  if (!identity.eligible || !identity.vault) return { eligible: false, market: null };
  if (input.schedule.isCancelable) return { eligible: false, market: null };
  if (input.schedule.cliffTime !== input.schedule.start) return { eligible: false, market: null };
  if (input.remaining < MIN_STREAM_AMOUNT) return { eligible: false, market: null };
  const market = input.markets.find(
    (row) =>
      isAddressEqual(row.vault, identity.vault!) &&
      isAddressEqual(row.ovrfloToken, input.asset) &&
      row.expiryCached === input.schedule.end &&
      input.now < row.expiryCached,
  );
  return market
    ? { eligible: true, market: market.market }
    : { eligible: false, market: null };
}

export function useStreams(input: {
  account: Address | null | undefined;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
  registryComplete: boolean;
  now: bigint;
}): {
  candidates: ReadOutcome<{ ids: readonly bigint[] }>;
  truth: ReadOutcome<StreamBook>;
} {
  const account = input.account;
  const configured = isConfiguredAddress(account ?? null);
  const publicClient = usePublicClient({ chainId });
  const checkpointStorageKey = configured && account ? scanCheckpointKey(chainId, account) : null;
  const [checkpointReady, setCheckpointReady] = useState(false);
  const [checkpoint, setCheckpoint] = useState<ReturnType<typeof readCheckpoint>>(null);

  useEffect(() => {
    if (!checkpointStorageKey) {
      setCheckpoint(null);
      setCheckpointReady(true);
      return;
    }
    setCheckpoint(readCheckpoint(checkpointStorageKey));
    setCheckpointReady(true);
  }, [checkpointStorageKey]);

  const persistCheckpoint = useCallback(
    (next: { number: bigint; hash: `0x${string}` }) => {
      if (!checkpointStorageKey) return;
      const stored = writeCheckpointMax(checkpointStorageKey, next);
      setCheckpoint(stored);
    },
    [checkpointStorageKey],
  );

  const vaultAddresses = useMemo(
    () => input.vaults.map((vault) => vault.vault).filter((address) => isConfiguredAddress(address)),
    [input.vaults],
  );

  const candidatesQuery = useQuery({
    queryKey: streamKeys.candidates(chainId, account),
    queryFn: async () => {
      if (!publicClient || !account) throw new Error("Public client is unavailable");
      if (!canStartBrowserDiscovery()) {
        throw new Error("Stream discovery cannot start during prerender");
      }
      const client = createViemDiscoveryClient(publicClient);
      const live = await captureHeadSnapshot(client);
      // Production scans through finalized so a 1-2 block reorg cannot orphan
      // events the checkpoint already advanced past. Anvil forks report mainnet
      // finality (~64 blocks behind latest), so local seed and arrange
      // transactions sit in that window and stay invisible unless the cap is
      // latest.
      const cap = runtimeProfile === "local" ? live.latest : live.finalized;
      const snapshot = { finalized: cap, latest: cap };
      const fromBlock = checkpoint?.number ?? factoryDeployment.blockNumber;
      const originScan = await scanLogs(client, {
        address: vaultAddresses,
        topics: depositedTopics(),
        fromBlock: fromBlock > 0n ? fromBlock : factoryDeployment.blockNumber,
        rangeSize: SCAN_RANGE,
        snapshot,
        previousCheckpoint: checkpoint ?? undefined,
        decode: decodeDepositedOrigin,
      });
      const transferScan = await scanLogs(client, {
        address: SABLIER_LOCKUP_ADDRESS,
        topics: recipientTransferTopics(account),
        fromBlock: fromBlock > 0n ? fromBlock : factoryDeployment.blockNumber,
        rangeSize: SCAN_RANGE,
        snapshot,
        previousCheckpoint: checkpoint ?? undefined,
        decode: decodeRecipientTransfer,
      });
      const failed = [originScan, transferScan].find((result) => result.status === "failed");
      if (failed && failed.status === "failed") {
        if (failed.failure.kind === "reorg") {
          if (checkpointStorageKey) {
            persistCheckpoint(failed.snapshot.finalized);
          }
        }
        throw new Error(failed.failure.message);
      }
      if (originScan.status !== "complete" || transferScan.status !== "complete") {
        throw new Error("Stream candidate scan did not complete");
      }
      const discovered = discoverStreamCandidates({
        vaultRegistry: { status: "complete", vaults: vaultAddresses },
        origins: originScan.logs.map((log) => log.decoded),
        recipientTransfers: transferScan.logs.map((log) => log.decoded),
        recipient: account,
        candidateLimit: CANDIDATE_LIMIT,
      });
      persistCheckpoint(originScan.snapshot.finalized);
      const ids = writeCandidateIdsUnion(
        streamCandidatesKey(chainId, account),
        discovered.candidateIds,
      ).slice(0, CANDIDATE_LIMIT);
      return {
        ids,
        status: discovered.status,
      };
    },
    ...readQuery,
    enabled:
      configured &&
      checkpointReady &&
      input.registryComplete &&
      vaultAddresses.length > 0 &&
      Boolean(publicClient),
  });

  const candidateIds = candidatesQuery.data?.ids ?? [];
  const truthContracts = useMemo(() => {
    if (!candidateIds.length) return [];
    return candidateIds.flatMap((streamId) => [
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "ownerOf" as const,
        args: [streamId] as const,
      },
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "getStream" as const,
        args: [streamId] as const,
      },
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "withdrawableAmountOf" as const,
        args: [streamId] as const,
      },
    ]);
  }, [candidateIds]);

  const truthReads = useReadContracts({
    allowFailure: true,
    contracts: truthContracts,
    query: {
      ...readQuery,
      enabled: configured && candidateIds.length > 0,
    },
  });

  const candidates: ReadOutcome<{ ids: readonly bigint[] }> = useMemo(() => {
    if (!configured || !input.registryComplete) return loadingOutcome();
    if (candidatesQuery.isPending && !candidatesQuery.data) return loadingOutcome();
    if (candidatesQuery.isError) {
      return unavailableOutcome([
        readFailure("useStreams", "transport", candidatesQuery.error ?? "candidate scan failed"),
      ]);
    }
    return readyOutcome({ ids: candidateIds });
  }, [
    candidateIds,
    candidatesQuery.data,
    candidatesQuery.error,
    candidatesQuery.isError,
    candidatesQuery.isPending,
    configured,
    input.registryComplete,
  ]);

  const truth: ReadOutcome<StreamBook> = useMemo(() => {
    if (candidates.status === "unavailable") {
      return unavailableOutcome(candidates.failures);
    }
    if (candidates.status !== "ready") {
      return loadingOutcome();
    }
    if (candidateIds.length === 0) {
      return readyOutcome({ candidates: [], streams: [] });
    }
    if (truthReads.isLoading && !truthReads.data) return loadingOutcome();
    const rows = truthReads.data;
    const expected = candidateIds.length * 3;
    if (!rows || rows.length !== expected) {
      return unavailableOutcome([
        readFailure("useStreams", "incomplete", "Stream truth batch is incomplete"),
      ]);
    }
    const streams: HydratedStream[] = [];
    for (const [index, streamId] of candidateIds.entries()) {
      const ownerResult = rows[index * 3];
      const streamResult = rows[index * 3 + 1];
      const withdrawableResult = rows[index * 3 + 2];
      if (
        ownerResult?.status !== "success" ||
        streamResult?.status !== "success" ||
        withdrawableResult?.status !== "success"
      ) {
        continue;
      }
      const owner = ownerResult.result as Address;
      if (!account || !isAddressEqual(owner, account)) continue;
      const stream = streamResult.result as {
        sender: Address;
        startTime: number;
        cliffTime: number;
        isCancelable: boolean;
        asset: Address;
        endTime: number;
        amounts: { deposited: bigint; withdrawn: bigint; refunded: bigint };
      };
      const withdrawable = withdrawableResult.result as bigint;
      const remaining = stream.amounts.deposited - stream.amounts.withdrawn - stream.amounts.refunded;
      const schedule: StreamScheduleParams = {
        start: BigInt(stream.startTime),
        end: BigInt(stream.endTime),
        deposited: stream.amounts.deposited,
        withdrawn: stream.amounts.withdrawn,
        refunded: stream.amounts.refunded,
        cliffTime: BigInt(stream.cliffTime),
        isCancelable: stream.isCancelable,
      };
      const render = renderEligibleStream({
        sender: stream.sender,
        asset: stream.asset,
        vaults: input.vaults,
      });
      if (!render.eligible) continue;
      const borrow = borrowRouteEligibleStream({
        sender: stream.sender,
        asset: stream.asset,
        schedule,
        remaining,
        now: input.now,
        vaults: input.vaults,
        markets: input.markets,
      });
      streams.push({
        streamId,
        owner,
        sender: stream.sender,
        asset: stream.asset,
        schedule,
        withdrawable,
        remaining: remaining < 0n ? 0n : remaining,
        renderEligible: true,
        borrowRouteEligible: borrow.eligible,
        vault: render.vault,
        market: borrow.market,
      });
    }
    const anyFailure = rows.some((result) => result.status !== "success");
    if (anyFailure && streams.length === 0) {
      return unavailableOutcome([
        readFailure("useStreams", "subcall", "Stream truth reads failed"),
      ]);
    }
    return readyOutcome({ candidates: candidateIds, streams });
  }, [
    account,
    candidateIds,
    candidates,
    input.markets,
    input.now,
    input.vaults,
    truthReads.data,
    truthReads.isLoading,
  ]);

  return { candidates, truth };
}
