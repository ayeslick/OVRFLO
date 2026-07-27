"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";

// R30 signer-switch guard: when the connected address changes while a form is open,
// reset the form's state and replace its body with a "WALLET CHANGED — RE-ENTER"
// notice until the user explicitly continues — never act on selections made as a
// different account.
export function useWalletChangeReset(current: Address | undefined, reset: () => void) {
  const [walletChanged, setWalletChanged] = useState(false);
  const previous = useRef(current);
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    if (previous.current !== undefined && current !== previous.current) {
      resetRef.current();
      setWalletChanged(true);
    }
    previous.current = current;
  }, [current]);

  return { walletChanged, acknowledge: () => setWalletChanged(false) };
}
