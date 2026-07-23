"use client";

import { useAppKit } from "@reown/appkit/react";
import { useConnection, useDisconnect } from "wagmi";
import { formatAddress } from "@/lib/format";

export function WalletButton() {
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
