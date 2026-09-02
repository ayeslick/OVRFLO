"use client";

import { chainId } from "@/lib/config";

const NETWORK_LABEL: Record<number, string> = {
  1: "Ethereum",
  31337: "Local",
};

export function networkLabel(id: number): string {
  return NETWORK_LABEL[id] ?? `Chain ${id}`;
}

export function NetworkChip() {
  return (
    <span className="kit-network" data-ui="UI-SHELL-NETWORK">
      {networkLabel(chainId)}
    </span>
  );
}