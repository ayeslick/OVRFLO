"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { removeIdentityQueries } from "@/lib/invalidate";

/**
 * R30 signer-switch guard: when the connected address or chain changes while a
 * form is open, reset the form and drop every address/chain-keyed query so no
 * surface keeps rendering the previous account's entities.
 */
export function useWalletChangeReset(
  current: Address | undefined,
  reset: () => void,
  identity?: { chainId?: number; queryClient?: QueryClient },
) {
  const [walletChanged, setWalletChanged] = useState(false);
  const previous = useRef({ account: current, chainId: identity?.chainId });
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    const accountChanged =
      previous.current.account !== undefined && current !== previous.current.account;
    const chainChanged =
      previous.current.chainId !== undefined &&
      identity?.chainId !== undefined &&
      identity.chainId !== previous.current.chainId;
    if (accountChanged || chainChanged) {
      resetRef.current();
      if (identity?.queryClient) {
        removeIdentityQueries(identity.queryClient, {
          account: accountChanged ? previous.current.account : undefined,
          chainId: chainChanged ? previous.current.chainId : undefined,
        });
      }
      setWalletChanged(true);
    }
    previous.current = { account: current, chainId: identity?.chainId };
  }, [current, identity?.chainId, identity?.queryClient]);

  const acknowledge = useCallback(() => setWalletChanged(false), []);

  return { walletChanged, acknowledge };
}
