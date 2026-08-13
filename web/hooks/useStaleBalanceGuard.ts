"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Hash } from "viem";
import { chainId } from "@/lib/config";
import {
  applyBalanceGuard,
  guardConfirmedBalances,
  type BalanceGuardVerdict,
} from "@/lib/receipts";

/**
 * After a receipt-confirmed write, a stale RPC must not resurrect pre-tx
 * balances. Null getTransactionReceipt → regress to PENDING.
 */
export function useStaleBalanceGuard(input: {
  hash?: Hash;
  confirmed: boolean;
  liveBalances: Record<string, bigint> | null;
  preTxBalances: Record<string, string> | null;
  lastKnownPostTx: Record<string, bigint> | null;
}): {
  balances: Record<string, bigint> | null;
  suppressed: boolean;
  status: "pending" | "confirmed" | null;
} {
  const publicClient = usePublicClient({ chainId });
  const [verdict, setVerdict] = useState<BalanceGuardVerdict | null>(null);

  useEffect(() => {
    if (!input.confirmed || !input.hash || !input.liveBalances || !input.preTxBalances) {
      setVerdict(null);
      return;
    }
    let cancelled = false;
    void guardConfirmedBalances({
      hash: input.hash,
      liveBalances: input.liveBalances,
      preTxBalances: input.preTxBalances,
      getTransactionReceipt: async (hash) => {
        if (!publicClient) return null;
        const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
        return receipt;
      },
    }).then((next) => {
      if (!cancelled) setVerdict(next);
    });
    return () => {
      cancelled = true;
    };
  }, [input.confirmed, input.hash, input.liveBalances, input.preTxBalances, publicClient]);

  if (!input.confirmed || !input.liveBalances) {
    return { balances: input.liveBalances, suppressed: false, status: input.confirmed ? "confirmed" : null };
  }
  if (verdict === null) {
    return { balances: input.liveBalances, suppressed: false, status: "confirmed" };
  }
  const applied = applyBalanceGuard(
    verdict,
    input.liveBalances,
    input.lastKnownPostTx ?? input.liveBalances,
  );
  return {
    balances: applied.balances,
    suppressed: verdict === "suppress-pre-tx",
    status: applied.status,
  };
}
