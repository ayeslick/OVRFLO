"use client";

import { useAppKit } from "@reown/appkit/react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { isE2E } from "@/lib/config";
import { formatAddress } from "@/lib/format";

// Split so E2E never mounts `useAppKit` — `ensureAppKit()` skips createAppKit
// when NEXT_PUBLIC_E2E=1, and calling the hook without that init throws
// "Please call createAppKit before using useAppKit" and 500s the whole page
// (every Playwright scenario then fails waiting for the connected-wallet
// button). Production keeps the AppKit modal path unchanged.

function ProductionWalletButton() {
  const { open } = useAppKit();
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const connected = connection.status === "connected";
  const address = connection.addresses?.[0];

  if (connected) {
    return (
      <button className="button mono" type="button" onClick={() => disconnect()}>
        {formatAddress(address)}
      </button>
    );
  }

  return (
    <button className="button mono" type="button" onClick={() => void open()}>
      CONNECT
    </button>
  );
}

function E2EWalletButton() {
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const { connect, connectors } = useConnect();
  const connected = connection.status === "connected";
  const address = connection.addresses?.[0];

  if (connected) {
    return (
      <button className="button mono" type="button" onClick={() => disconnect()}>
        {formatAddress(address)}
      </button>
    );
  }

  // Mock connector is defaultConnected+reconnect, but first paint can still
  // race reconnect — offer an explicit connect so the page isn't stuck on
  // CONNECT if auto-reconnect hasn't finished yet.
  return (
    <button
      className="button mono"
      type="button"
      onClick={() => {
        const connector = connectors[0];
        if (connector) connect({ connector });
      }}
    >
      CONNECT
    </button>
  );
}

export function WalletButton() {
  return isE2E ? <E2EWalletButton /> : <ProductionWalletButton />;
}
