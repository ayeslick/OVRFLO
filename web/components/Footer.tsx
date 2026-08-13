"use client";

import { chainId, factoryAddress, isConfiguredAddress } from "@/lib/config";

const EXPLORER: Record<number, string> = {
  1: "https://etherscan.io",
};

export function Footer() {
  const explorer = EXPLORER[chainId];
  const factoryLink =
    explorer && isConfiguredAddress(factoryAddress)
      ? `${explorer}/address/${factoryAddress}`
      : null;

  return (
    <footer className="watch-footer">
      <a href="/risk">RISK</a>
      {factoryLink ? (
        <a href={factoryLink} rel="noopener noreferrer" target="_blank">
          FACTORY ↗
        </a>
      ) : null}
    </footer>
  );
}
