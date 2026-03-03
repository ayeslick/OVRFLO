"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchUserStreams, type SablierStream } from "@/lib/sablier";

export function useUserStreams(
  userAddress: string | undefined,
  ovrfloAddresses: string[]
) {
  return useQuery<SablierStream[]>({
    queryKey: ["streams", userAddress, ovrfloAddresses],
    queryFn: () => fetchUserStreams(userAddress!, ovrfloAddresses),
    enabled: !!userAddress && ovrfloAddresses.length > 0,
    staleTime: 60_000,
  });
}
