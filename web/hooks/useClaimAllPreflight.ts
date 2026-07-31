"use client";

import type { Address } from "viem";
import { chainId, factoryAddress, factoryDeployment } from "@/lib/config";
import {
  discoverClaimAllCandidates,
  discoverClaimAllRegistry,
  type ClaimAllDiscoveryProjection,
  type ProjectionReadClient,
} from "@/lib/discovery/live-projection";
import { captureHeadSnapshot } from "@/lib/discovery/log-scanner";
import {
  evaluateClaimAllPreflight,
  mergeClaimAllPreflightCache,
  sameClaimAllCandidates,
  type ClaimAllPreflightEvaluation,
  type ClaimAllPreflightProgress,
  type ClaimAllPreflightReason,
} from "@/lib/claim-all";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { getProjectionClient } from "./useProjectionSync";
import { useProjectionSync } from "./useProjectionSync";

function unavailableCandidates(
  source: string,
  error: unknown,
  blockNumber: bigint,
  blockHash: `0x${string}`,
) {
  return unavailableOutcome<readonly never[]>(
    [readFailure(source, "transport", error, { retryable: true })],
    { blockNumber, blockHash },
  );
}

function blockedEvaluation(
  reason: ClaimAllPreflightReason,
  message: string,
): ClaimAllPreflightEvaluation {
  const progress: ClaimAllPreflightProgress[] = (
    ["markets", "streams", "hydration", "verifier"] as const
  ).map((source) => ({
    source,
    status: "failed",
    retryable: true,
    message,
  }));
  return {
    status: "blocked",
    canReview: false,
    reason,
    candidateIds: [],
    progress,
  };
}

function sameRegistry(
  left: {
    entries: readonly { vault: Address; lending: Address | null }[];
    vaults: readonly Address[];
    lendings: readonly Address[];
  },
  right: {
    entries: readonly { vault: Address; lending: Address | null }[];
    vaults: readonly Address[];
    lendings: readonly Address[];
  },
) {
  const normalize = (addresses: readonly Address[]) =>
    [...new Set(addresses.map((address) => address.toLowerCase()))].sort();
  const sameAddresses = (
    leftAddresses: readonly Address[],
    rightAddresses: readonly Address[],
  ) => {
    const normalizedLeft = normalize(leftAddresses);
    const normalizedRight = normalize(rightAddresses);
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every(
        (address, index) => address === normalizedRight[index],
      )
    );
  };
  const normalizeEntries = (
    entries: readonly { vault: Address; lending: Address | null }[],
  ) =>
    entries
      .map(
        ({ vault, lending }) =>
          `${vault.toLowerCase()}:${lending?.toLowerCase() ?? "none"}`,
      )
      .sort();
  const leftEntries = normalizeEntries(left.entries);
  const rightEntries = normalizeEntries(right.entries);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every((entry, index) => entry === rightEntries[index]) &&
    sameAddresses(left.vaults, right.vaults) &&
    sameAddresses(left.lendings, right.lendings)
  );
}

function preflightOutcome(
  primary: ReadOutcome<ClaimAllDiscoveryProjection>,
  verifier: ReadOutcome<ClaimAllDiscoveryProjection>,
  account: Address,
  target: { number: bigint; hash: `0x${string}` },
): ReadOutcome<ClaimAllPreflightEvaluation> {
  const metadata = {
    blockNumber: target.number,
    blockHash: target.hash,
  };
  const primaryPools =
    primary.status === "ready"
      ? readyOutcome(primary.data.poolCandidateIds, metadata)
      : unavailableOutcome<readonly never[]>(primary.failures, metadata);
  const primaryStreams =
    primary.status === "ready"
      ? readyOutcome(primary.data.streamCandidateIds, metadata)
      : unavailableOutcome<readonly never[]>(primary.failures, metadata);
  const hydration =
    primary.status === "ready"
      ? readyOutcome(primary.data.candidateIds, metadata)
      : unavailableOutcome<readonly never[]>(primary.failures, metadata);
  const verifierCandidates =
    verifier.status === "ready"
      ? readyOutcome(verifier.data.candidateIds, metadata)
      : unavailableCandidates(
          "claim-all-verifier",
          verifier.failures
            .map((failure) => failure.message)
            .join("; ") || "Claim All verifier is unavailable",
          target.number,
          target.hash,
        );
  const cache = mergeClaimAllPreflightCache(undefined, {
    identity: { account, chainId },
    target,
    sources: {
      markets: primaryPools,
      streams: primaryStreams,
      hydration,
      verifier: verifierCandidates,
    },
  });
  return readyOutcome(evaluateClaimAllPreflight(cache), metadata);
}

export async function loadClaimAllPreflight({
  primaryClient,
  verifierClient,
  account,
  signal,
}: {
  primaryClient: ProjectionReadClient;
  verifierClient: ProjectionReadClient;
  account: Address;
  signal?: AbortSignal;
}): Promise<ReadOutcome<ClaimAllPreflightEvaluation>> {
  const snapshot = await captureHeadSnapshot(primaryClient);
  const target = snapshot.latest;
  const metadata = {
    blockNumber: target.number,
    blockHash: target.hash,
  };
  const [primaryRegistry, verifierRegistry] = await Promise.all([
    discoverClaimAllRegistry({
      client: primaryClient,
      factory: factoryAddress,
      snapshot,
      signal,
    }),
    discoverClaimAllRegistry({
      client: verifierClient,
      factory: factoryAddress,
      snapshot,
      signal,
    }),
  ]);
  if (verifierRegistry.status !== "ready") {
    return readyOutcome(
      blockedEvaluation(
        "verifier-unavailable",
        verifierRegistry.failures
          .map((failure) => failure.message)
          .join("; ") || "Independent registry verifier is unavailable",
      ),
      metadata,
    );
  }
  if (primaryRegistry.status !== "ready") {
    return readyOutcome(
      blockedEvaluation(
        "discovery-incomplete",
        primaryRegistry.failures
          .map((failure) => failure.message)
          .join("; ") || "Primary registry discovery is incomplete",
      ),
      metadata,
    );
  }
  if (!sameRegistry(primaryRegistry.data, verifierRegistry.data)) {
    return readyOutcome(
      blockedEvaluation(
        "provider-disagreement",
        "RPC providers disagree on the pinned factory registry",
      ),
      metadata,
    );
  }

  const discover = (
    client: ProjectionReadClient,
    registry: typeof primaryRegistry.data,
  ) =>
    discoverClaimAllCandidates({
      client,
      lendings: registry.lendings,
      vaults: registry.vaults,
      account,
      fromBlock: factoryDeployment.blockNumber,
      snapshot,
      signal,
    });
  const [primary, verifier] = await Promise.all([
    discover(primaryClient, primaryRegistry.data),
    discover(verifierClient, verifierRegistry.data),
  ]);
  if (
    primary.status === "ready" &&
    verifier.status === "ready" &&
    !sameClaimAllCandidates(
      primary.data.candidateIds,
      verifier.data.candidateIds,
    )
  ) {
    return readyOutcome(
      blockedEvaluation(
        "provider-disagreement",
        "RPC providers disagree on directly hydrated Claim All candidates",
      ),
      metadata,
    );
  }
  return preflightOutcome(primary, verifier, account, target);
}

export function useClaimAllPreflight(
  account: Address | undefined,
  enabled: boolean,
) {
  const query = useProjectionSync<ClaimAllPreflightEvaluation>({
    scope: {
      kind: "claim-verifier",
      account,
    },
    enabled: Boolean(account) && enabled,
    staleTime: 0,
    queryFn: (primaryClient, signal) =>
      loadClaimAllPreflight({
        primaryClient,
        verifierClient: getProjectionClient("verifier"),
        account: account as Address,
        signal,
      }),
  });
  return {
    evaluation:
      query.outcome.status === "ready" && !query.isFetching
        ? query.outcome.data
        : undefined,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  };
}
