"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { chainId, factoryAddress } from "@/lib/config";
import {
  discoverProtocolBootstrap,
  type ProtocolBootstrap,
} from "@/lib/protocol-bootstrap";
import { protocolBootstrapKeys, READ_INTERVAL_MS } from "@/lib/query-keys";

export function useProtocolBootstrap(): ProtocolBootstrap {
  const publicClient = usePublicClient({ chainId });
  const query = useQuery({
    queryKey: protocolBootstrapKeys.root(factoryAddress, chainId),
    queryFn: async (): Promise<Exclude<ProtocolBootstrap, { status: "loading" }>> => {
      if (!publicClient) {
        return {
          status: "unavailable",
          failures: [{ code: "rpc_revert", message: "Public client is unavailable" }],
        };
      }
      return discoverProtocolBootstrap(publicClient, factoryAddress, chainId);
    },
    enabled: Boolean(publicClient),
    refetchInterval: READ_INTERVAL_MS,
    refetchOnWindowFocus: false,
    staleTime: READ_INTERVAL_MS,
    retry: 1,
  });

  if (query.data) return query.data;
  if (query.isError) {
    return {
      status: "unavailable",
      failures: [
        {
          code: "rpc_revert",
          message: query.error instanceof Error ? query.error.message : "Bootstrap query failed",
        },
      ],
    };
  }
  return { status: "loading" };
}
