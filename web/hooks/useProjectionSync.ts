"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import {
  chainId,
  factoryDeployment,
  historicalRpcUrl,
  rpcUrls,
} from "@/lib/config";
import {
  createProjectionReadClient,
  type ProjectionReadClient,
} from "@/lib/discovery/live-projection";
import type { ProjectionScopeKey } from "@/lib/query-keys";
import { projectionKeys, DISCOVERY_GC_TIME_MS } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { createHistoricalTransport } from "@/lib/rpc";
import { canStartBrowserDiscovery } from "@/lib/browser-runtime";

type ProjectionTransportRole = "primary" | "verifier";

// Cached per URL rather than as bare singletons: a credential forward-roll
// (docs/operations/rpc-credential-forward-roll.md) or an env change must not
// leave every later getProjectionClient() call silently pinned to the
// transport that was active at first render.
const clientsByUrl = new Map<string, ProjectionReadClient>();

function clientFor(url: string): ProjectionReadClient {
  let client = clientsByUrl.get(url);
  if (!client) {
    client = createProjectionReadClient(
      createPublicClient({
        chain: mainnet,
        transport: createHistoricalTransport(url),
      }),
    );
    clientsByUrl.set(url, client);
  }
  return client;
}

function verifierRpcUrl(): string | null {
  return rpcUrls.find((candidate) => candidate !== historicalRpcUrl) ?? null;
}

export function getProjectionClient(
  role: ProjectionTransportRole,
): ProjectionReadClient {
  if (role === "primary") {
    return clientFor(historicalRpcUrl);
  }

  const url = verifierRpcUrl();
  if (!url) {
    throw new Error(
      "Claim All requires a second RPC provider distinct from the historical projection provider",
    );
  }
  return clientFor(url);
}

type ProjectionQueryInput<T> = {
  scope: Omit<ProjectionScopeKey, "chainId" | "factoryAnchor">;
  enabled: boolean;
  queryFn: (client: ProjectionReadClient, signal: AbortSignal) => Promise<ReadOutcome<T>>;
  refetchInterval?: number;
  staleTime?: number;
};

export function useProjectionSync<T>({
  scope,
  enabled,
  queryFn,
  refetchInterval,
  staleTime = 15_000,
}: ProjectionQueryInput<T>) {
  const browserEnabled = canStartBrowserDiscovery();
  const transportRole = scope.transportRole ?? "primary";
  const query = useQuery({
    queryKey: projectionKeys.scope({
      chainId,
      factoryAnchor: {
        number: factoryDeployment.blockNumber,
        hash: factoryDeployment.blockHash,
      },
      ...scope,
    }),
    enabled: enabled && browserEnabled,
    queryFn: async ({ signal }) => {
      try {
        return await queryFn(getProjectionClient(transportRole), signal);
      } catch (error) {
        return unavailableOutcome<T>([
          readFailure("projection-sync", "transport", error, { retryable: true }),
        ]);
      }
    },
    gcTime: DISCOVERY_GC_TIME_MS,
    staleTime,
    refetchInterval,
    retry: false,
  });

  const outcome: ReadOutcome<T> =
    query.data ??
    (query.error
      ? unavailableOutcome([
          readFailure("projection-sync", "transport", query.error, {
            retryable: true,
          }),
        ])
      : loadingOutcome());
  return {
    outcome,
    isLoading: outcome.status === "loading" || query.isFetching,
    isFetching: query.isFetching,
    error:
      outcome.status === "unavailable"
        ? new Error(
            outcome.failures.map((failure) => failure.message).join("; ") ||
              "Projection is unavailable",
          )
        : null,
    refetch: query.refetch,
  };
}
