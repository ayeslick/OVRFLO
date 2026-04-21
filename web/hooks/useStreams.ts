"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import {
  fetchUserStreams,
  StreamScanError,
  type SablierStream,
} from "@/lib/sablier";
import { OVRFLO_FACTORY } from "@/lib/config";

export function useUserStreams(
  userAddress: string | undefined,
  ovrfloAddresses: string[]
) {
  const publicClient = usePublicClient();

  return useQuery<SablierStream[], StreamScanError | Error>({
    queryKey: [
      "streams",
      OVRFLO_FACTORY,
      userAddress,
      ovrfloAddresses.slice().sort().join(","),
    ],
    queryFn: () => {
      if (!publicClient || !userAddress) return Promise.resolve([]);
      return fetchUserStreams({
        publicClient,
        user: userAddress as `0x${string}`,
        ovrfloAddresses: ovrfloAddresses as `0x${string}`[],
      });
    },
    enabled:
      !!publicClient && !!userAddress && ovrfloAddresses.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount) => failureCount < 2,
  });
}
