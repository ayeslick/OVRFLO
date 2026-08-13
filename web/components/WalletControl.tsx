"use client";

import { useAppKit } from "@reown/appkit/react";
import { useConnection, useDisconnect } from "wagmi";
import { AddressChip } from "@/components/kit/AddressChip";
import "./watch/watch.css";

export function WalletControl() {
  const { open } = useAppKit();
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const connected = connection.status === "connected";
  const address = connection.addresses?.[0];

  if (connected && address) {
    return (
      <span className="watch-wallet" data-state="connected">
        <AddressChip address={address} label="Copy wallet address" />
        <button type="button" className="watch-wallet-disconnect" onClick={() => disconnect()}>
          DISCONNECT
        </button>
      </span>
    );
  }

  return (
    <button type="button" className="watch-wallet-connect" onClick={() => void open()}>
      CONNECT WALLET
    </button>
  );
}
