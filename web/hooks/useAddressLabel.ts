"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { truncateAddress } from "@/lib/format";

interface UseAddressLabelOptions {
  enabled?: boolean;
}

interface UseAddressLabelResult {
  label: string;
  ensName: string | null;
  isLoading: boolean;
}

/**
 * Resolve an ENS primary name for an address, falling back to a safely
 * truncated `0x1234…abcd` label when resolution is absent or pending.
 * ENS lookup is always pinned to mainnet (chain id 1) because OVRFLO
 * itself only runs on mainnet / mainnet-forking RPCs, which all carry
 * the canonical ENS registry.
 */
export function useAddressLabel(
  address: `0x${string}` | undefined,
  { enabled = true }: UseAddressLabelOptions = {}
): UseAddressLabelResult {
  const { data, isLoading } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: enabled && Boolean(address) },
  });

  const fallback = truncateAddress(address);
  const label = data ?? fallback;

  return {
    label,
    ensName: data ?? null,
    isLoading: Boolean(address) && isLoading,
  };
}
