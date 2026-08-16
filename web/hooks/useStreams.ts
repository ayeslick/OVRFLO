"use client";

import { useMemo, useRef } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { isAddressEqual, type Address } from "viem";
import { sablierLockupAbi } from "@/lib/abis";
import { isConfiguredAddress, ZERO_ADDRESS } from "@/lib/config";
import { useProtocolBootstrap } from "./useProtocolBootstrap";
import { MAX_ENUMERATION_IDS, MIN_STREAM_AMOUNT } from "@/lib/lending-math";
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { MarketInfo, VaultInfo } from "@/lib/types";

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
  /** Lockup.Status enum from statusOf — U9 paints from this. */
  status: number;
  /** Streams lens: vault sender + ovrflo asset. Matured markets stay visible. */
  renderEligible: boolean;
  /** Borrow route: full requireEligible including SeriesMatured + MIN_STREAM_AMOUNT. */
  borrowRouteEligible: boolean;
  vault: Address | null;
  market: Address | null;
};

export type StreamBook = {
  streams: readonly HydratedStream[];
};

export type StreamMarket = Pick<
  MarketInfo,
  "vault" | "market" | "ovrfloToken" | "expiryCached"
>;

type FixedStreamFields = {
  sender: Address;
  asset: Address;
  start: bigint;
  end: bigint;
  cliffTime: bigint;
  deposited: bigint;
  isCancelable: boolean;
};

type LockupStreamResult = {
  sender: Address;
  startTime: number;
  cliffTime: number;
  isCancelable: boolean;
  asset: Address;
  endTime: number;
  isDepleted: boolean;
  amounts: { deposited: bigint; withdrawn: bigint; refunded: bigint };
};

const STATE_CALLS_PER_ID = 4;

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

/**
 * Held-stream discovery via Enumerable staging (KTD2):
 * balanceOf → tokensOfOwnerIn → ownerOf+getStream+withdrawable+statusOf.
 */
export function useStreams(input: {
  account: Address | null | undefined;
  vaults: readonly Pick<VaultInfo, "vault" | "ovrfloToken">[];
  markets: readonly StreamMarket[];
  registryComplete: boolean;
  now: bigint;
  /** Present only when factory bootstrap is ready — never a null sentinel. */
  stream?: Address;
}): ReadOutcome<StreamBook> {
  const bootstrap = useProtocolBootstrap();
  if (bootstrap.status === "loading" && input.stream === undefined) {
    return loadingOutcome();
  }
  if (bootstrap.status === "unavailable" && input.stream === undefined) {
    return unavailableOutcome(
      bootstrap.failures.map((failure) =>
        readFailure("useStreams", "transport", failure.message),
      ),
    );
  }
  const discovered =
    input.stream ??
    (bootstrap.status === "ready" ? bootstrap.stream : undefined);
  const account = input.account;
  const lockupConfigured = isConfiguredAddress(discovered ?? null);
  const configured =
    isConfiguredAddress(account ?? null) && lockupConfigured && input.registryComplete;

  const fixedCache = useRef(new Map<string, FixedStreamFields>());

  const balanceRead = useReadContract({
    address: (discovered ?? ZERO_ADDRESS),
    abi: sablierLockupAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { ...readQuery, enabled: configured },
  });

  const balance = (balanceRead.data as bigint | undefined) ?? 0n;
  const balanceOk = balanceRead.isSuccess;
  const overBudget = balanceOk && balance > MAX_ENUMERATION_IDS;
  const idEnabled = configured && balanceOk && balance > 0n && !overBudget;

  const idRead = useReadContract({
    address: (discovered ?? ZERO_ADDRESS),
    abi: sablierLockupAbi,
    functionName: "tokensOfOwnerIn",
    args: account && idEnabled ? [account, 0n, balance] : undefined,
    query: { ...readQuery, enabled: idEnabled },
  });

  const idsComplete = !idEnabled || idRead.isSuccess;
  const ids = useMemo(() => {
    if (!idsComplete || !idEnabled) return [] as bigint[];
    const raw = idRead.data as readonly bigint[] | undefined;
    if (!raw) return [];
    return raw.filter((value) => value > 0n);
  }, [idEnabled, idRead.data, idsComplete]);

  const stateEnabled = configured && idsComplete && ids.length > 0;
  const stateContracts = useMemo(() => {
    if (!stateEnabled) return [];
    return ids.flatMap((streamId) => [
      {
        address: (discovered ?? ZERO_ADDRESS),
        abi: sablierLockupAbi,
        functionName: "ownerOf" as const,
        args: [streamId] as const,
      },
      {
        address: (discovered ?? ZERO_ADDRESS),
        abi: sablierLockupAbi,
        functionName: "getStream" as const,
        args: [streamId] as const,
      },
      {
        address: (discovered ?? ZERO_ADDRESS),
        abi: sablierLockupAbi,
        functionName: "withdrawableAmountOf" as const,
        args: [streamId] as const,
      },
      {
        address: (discovered ?? ZERO_ADDRESS),
        abi: sablierLockupAbi,
        functionName: "statusOf" as const,
        args: [streamId] as const,
      },
    ]);
  }, [discovered, ids, stateEnabled]);

  const stateReads = useReadContracts({
    allowFailure: true,
    contracts: stateContracts,
    query: { ...readQuery, enabled: stateEnabled },
  });

  const dataUpdatedAt = Math.max(
    balanceRead.dataUpdatedAt ?? 0,
    idRead.dataUpdatedAt ?? 0,
    stateReads.dataUpdatedAt ?? 0,
  );

  return useMemo(() => {
    const meta = dataUpdatedAt > 0 ? { dataUpdatedAt } : {};

    if (!configured) return loadingOutcome<StreamBook>(undefined, meta);
    if (balanceRead.isLoading && balanceRead.data === undefined) {
      return loadingOutcome<StreamBook>(undefined, meta);
    }
    if (balanceRead.isError) {
      return unavailableOutcome<StreamBook>(
        [readFailure("useStreams", "transport", balanceRead.error ?? "balanceOf failed")],
        meta,
      );
    }
    if (overBudget) {
      return unavailableOutcome<StreamBook>(
        [
          readFailure(
            "useStreams",
            "incomplete",
            "Held-stream enumeration exceeds the fail-closed budget",
          ),
        ],
        meta,
      );
    }
    if (balance === 0n) {
      fixedCache.current.clear();
      return readyOutcome({ streams: [] }, meta);
    }
    if (idRead.isLoading && idRead.data === undefined) {
      return loadingOutcome<StreamBook>(undefined, meta);
    }
    if (idRead.isError) {
      return unavailableOutcome<StreamBook>(
        [
          readFailure(
            "useStreams",
            "transport",
            idRead.error ?? "tokensOfOwnerIn failed",
          ),
        ],
        meta,
      );
    }
    if (!idsComplete) {
      return unavailableOutcome<StreamBook>(
        [readFailure("useStreams", "subcall", "tokensOfOwnerIn batch is incomplete")],
        meta,
      );
    }
    if (ids.length === 0) {
      fixedCache.current.clear();
      // Ready-empty is only a zero balance. A positive balance with no ids is
      // incomplete enumeration, never confirmed-empty.
      return unavailableOutcome<StreamBook>(
        [
          readFailure(
            "useStreams",
            "incomplete",
            "tokensOfOwnerIn returned no ids while balanceOf is nonzero",
          ),
        ],
        meta,
      );
    }
    if (stateReads.isLoading && !stateReads.data) {
      return loadingOutcome<StreamBook>(undefined, meta);
    }
    const rows = stateReads.data;
    const expected = ids.length * STATE_CALLS_PER_ID;
    if (!rows || rows.length !== expected) {
      return unavailableOutcome<StreamBook>(
        [readFailure("useStreams", "incomplete", "Stream state batch is incomplete")],
        meta,
      );
    }

    const streams: HydratedStream[] = [];
    const seenKeys = new Set<string>();
    for (const [index, streamId] of ids.entries()) {
      const base = index * STATE_CALLS_PER_ID;
      const ownerResult = rows[base];
      const streamResult = rows[base + 1];
      const withdrawableResult = rows[base + 2];
      const statusResult = rows[base + 3];
      // Benign per-id failure (burned / notNull / shrink): drop the row, keep the book.
      if (
        ownerResult?.status !== "success" ||
        streamResult?.status !== "success" ||
        withdrawableResult?.status !== "success" ||
        statusResult?.status !== "success"
      ) {
        continue;
      }
      const owner = ownerResult.result as Address;
      if (!account || !isAddressEqual(owner, account)) continue;

      const raw = streamResult.result as LockupStreamResult;
      const key = streamId.toString();
      seenKeys.add(key);
      let fixed = fixedCache.current.get(key);
      if (!fixed) {
        fixed = {
          sender: raw.sender,
          asset: raw.asset,
          start: BigInt(raw.startTime),
          end: BigInt(raw.endTime),
          cliffTime: BigInt(raw.cliffTime),
          deposited: raw.amounts.deposited,
          isCancelable: raw.isCancelable,
        };
        fixedCache.current.set(key, fixed);
      }

      const withdrawn = raw.amounts.withdrawn;
      const refunded = raw.amounts.refunded;
      const remaining = fixed.deposited - withdrawn - refunded;
      if (remaining <= 0n || raw.isDepleted) continue;

      const schedule: StreamScheduleParams = {
        start: fixed.start,
        end: fixed.end,
        deposited: fixed.deposited,
        withdrawn,
        refunded,
        cliffTime: fixed.cliffTime,
        isCancelable: fixed.isCancelable,
      };
      const render = renderEligibleStream({
        sender: fixed.sender,
        asset: fixed.asset,
        vaults: input.vaults,
      });
      if (!render.eligible) continue;
      const borrow = borrowRouteEligibleStream({
        sender: fixed.sender,
        asset: fixed.asset,
        schedule,
        remaining,
        now: input.now,
        vaults: input.vaults,
        markets: input.markets,
      });
      streams.push({
        streamId,
        owner,
        sender: fixed.sender,
        asset: fixed.asset,
        schedule,
        withdrawable: withdrawableResult.result as bigint,
        remaining,
        status: Number(statusResult.result),
        renderEligible: true,
        borrowRouteEligible: borrow.eligible,
        vault: render.vault,
        market: borrow.market,
      });
    }

    for (const key of [...fixedCache.current.keys()]) {
      if (!seenKeys.has(key)) fixedCache.current.delete(key);
    }

    const anyFailure = rows.some((result) => result.status !== "success");
    if (anyFailure && streams.length === 0 && ids.length > 0) {
      // Every enumerated id failed — treat as unavailable, not confirmed-empty.
      return unavailableOutcome<StreamBook>(
        [readFailure("useStreams", "subcall", "Stream state reads failed")],
        meta,
      );
    }

    return readyOutcome({ streams }, meta);
  }, [
    account,
    balance,
    balanceRead.data,
    balanceRead.dataUpdatedAt,
    balanceRead.error,
    balanceRead.isError,
    balanceRead.isLoading,
    configured,
    dataUpdatedAt,
    idRead.data,
    idRead.dataUpdatedAt,
    idRead.error,
    idRead.isError,
    idRead.isLoading,
    ids,
    idsComplete,
    bootstrap,
    input.markets,
    input.now,
    input.stream,
    input.vaults,
    overBudget,
    stateReads.data,
    stateReads.dataUpdatedAt,
    stateReads.isLoading,
  ]);
}
