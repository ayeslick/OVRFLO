"use client";

import { useConnection, useSwitchChain } from "wagmi";
import { chainId as configuredChainId } from "@/lib/config";

// R5/H-2: a wallet pointed at a chain other than the configured one must not be
// able to reach a write. The gate is only half of it — every write also names
// its expected chain (R6/KTD5), so a broadcast is refused at the write layer
// even when the gate is bypassed by a stale tab or a switch that races a click.
//
// `wrongChain` is deliberately false while disconnected or reconnecting:
// `connection.chainId` is undefined then, and rendering a switch-network prompt
// to someone with no wallet attached would displace the CONNECT WALLET path.
export function useChainGuard() {
  const connection = useConnection();
  const { switchChain, isPending, error } = useSwitchChain();

  const connectedChainId = connection.chainId;
  const wrongChain = connection.status === "connected" && connectedChainId !== configuredChainId;

  return {
    wrongChain,
    connectedChainId,
    expectedChainId: configuredChainId,
    switchChain: () => switchChain({ chainId: configuredChainId }),
    isSwitching: isPending,
    switchError: error,
  };
}
