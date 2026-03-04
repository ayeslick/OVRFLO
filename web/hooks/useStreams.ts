"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchUserStreams,
  SablierIndexerError,
  type SablierStream,
} from "@/lib/sablier";

export function useUserStreams(
  userAddress: string | undefined,
  ovrfloAddresses: string[]
) {
  return useQuery<SablierStream[], SablierIndexerError | Error>({
    queryKey: ["streams", userAddress, ovrfloAddresses],
    queryFn: () => fetchUserStreams(userAddress!, ovrfloAddresses),
    enabled: !!userAddress && ovrfloAddresses.length > 0,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof SablierIndexerError && error.graphqlErrors) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
