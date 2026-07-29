"use client";

import { useAppKit } from "@reown/appkit/react";
import { useConnection, useDisconnect } from "wagmi";
import type { Config } from "wagmi";
import { ensureAppKit, wagmiConfig } from "@/lib/wagmi";
import { formatAddress } from "@/lib/format";
import { CopyValue } from "./CopyValue";

// The production wallet runtime, and one half of the app's only test seam.
//
// Everything wallet-specific lives behind the `wallet-runtime` module
// specifier: the wagmi config, the one-time wallet-kit initialisation, and the
// button that drives connect/disconnect. E2E resolves that specifier to
// tests/e2e/support/WalletRuntime.tsx via a Turbopack alias (see
// next.config.ts), so the swap happens at build time and the production bundle
// contains no test code.
//
// This replaced three runtime `isE2E ? … : …` branches. Those shipped the mock
// connector into the production bundle, made the production wallet path
// unreachable by every test tier, and could be activated by a stray
// NEXT_PUBLIC_E2E in any build. A build-time seam has none of those properties:
// selecting the E2E runtime requires running a different command, not setting
// an environment variable.

export const walletConfig: Config = wagmiConfig;

export function ensureWalletKit() {
  ensureAppKit();
}

export function WalletButton() {
  const { open } = useAppKit();
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const connected = connection.status === "connected";
  const address = connection.addresses?.[0];

  if (connected) {
    return (
      <span className="wallet-identity">
        {/* L-13: the address is truncated for display, so without this the full
            value is unrecoverable from the UI. Separate control from DISCONNECT
            — nesting a button inside a button is invalid and unreachable by
            keyboard. */}
        <CopyValue value={address ?? ""} display={formatAddress(address)} label="Copy wallet address" />
        <button className="button mono" type="button" onClick={() => disconnect()}>
          DISCONNECT
        </button>
      </span>
    );
  }

  return (
    <button className="button mono" type="button" onClick={() => void open()}>
      CONNECT
    </button>
  );
}
