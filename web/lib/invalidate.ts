import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { streamKeys } from "./query-keys";

// Coarse post-write invalidation (plan KTD5/KTD10), shared by useWriteFlow and the
// claim-all queue so the two paths cannot drift. wagmi v3 roots useReadContract /
// useReadContracts keys at these string literals (verified against wagmi 3.7.3),
// so prefix matching refetches every mounted on-chain read.
export function invalidateAllOnChainReads(queryClient: QueryClient, user?: Address) {
  queryClient.invalidateQueries({ queryKey: ["readContract"] });
  queryClient.invalidateQueries({ queryKey: ["readContracts"] });
  queryClient.invalidateQueries({ queryKey: streamKeys.held(user) });
}

const bigintSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

// The held-streams list is Ponder-backed, so the instant invalidation above races the
// indexer (2s polling + indexing time). Re-invalidate on a short schedule, stopping
// early once the result set changes; 3 attempts total including the immediate one so a
// persistently stale indexer never loops. Returns a cleanup that cancels pending timers.
export function scheduleHeldStreamsRetry(
  queryClient: QueryClient,
  user: Address | undefined,
  delaysMs: readonly number[] = [2000, 5000],
) {
  const queryKey = streamKeys.held(user);
  const initial = JSON.stringify(queryClient.getQueryData(queryKey) ?? null, bigintSafe);
  const timers = delaysMs.map((delay) =>
    setTimeout(() => {
      const current = JSON.stringify(queryClient.getQueryData(queryKey) ?? null, bigintSafe);
      if (current !== initial) return;
      queryClient.invalidateQueries({ queryKey });
    }, delay),
  );
  return () => timers.forEach((timer) => clearTimeout(timer));
}
