"use client";

import { createConfig, http, useConnect, useConnection, useDisconnect, type Config } from "wagmi";
import { mainnet as viemMainnet } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import type { Address } from "viem";
import { rpcUrl } from "@/lib/config";
import { formatAddress } from "@/lib/format";
import { CopyValue } from "@/components/CopyValue";

// The E2E wallet runtime. Turbopack resolves the `wallet-runtime` specifier
// here when E2E_WALLET_RUNTIME=1 (see next.config.ts), so this file is only
// ever reachable from a deliberately-started E2E dev server — never from
// `npm run build`.
//
// It must not import @/lib/wagmi: that module constructs Reown's WagmiAdapter
// at module scope, which performs WalletConnect setup a sandboxed or offline
// runner cannot always complete (KTD6). That is the whole reason this seam
// exists, so the boundary is the point rather than an implementation detail.

// Anvil's well-known account #1 — one of ten dev-mnemonic addresses Anvil
// derives and unlocks internally on every local fork. It is never funded on any
// real chain and no private key for it exists anywhere in this codebase: the
// `mock` connector only forwards requests (eth_sendTransaction, personal_sign,
// …) as raw JSON-RPC to the chain the app points at, and Anvil signs for its
// own default accounts internally. Also `script/seed-local.sh`'s `$DEV_WALLET`
// default — keep the two in lockstep.
export const E2E_DEV_ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// Anvil account #3 — seed-local.sh never funds it with a stream or loan, so
// first-run.feature can switch here without draining the seeded demo book.
export const E2E_EMPTY_ACCOUNT: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

// The mock connector's provider reads `chain.rpcUrls.default.http[0]` directly
// (see @wagmi/core's connectors/mock.ts) rather than the `transports` map
// below, so both must point at the local fork.
const e2eChain = {
  ...viemMainnet,
  rpcUrls: { default: { http: [rpcUrl ?? "http://127.0.0.1:8545"] } },
};

// `ssr: true` is required here, not optional: without it, wagmi's `Hydrate`
// runs the mock connector's reconnect synchronously during the server render
// pass too (`if (!config._internal.ssr) onMount()` fires on every render,
// server included). Once that reconnect resolves server-side, every later
// response renders the connected address while each fresh client bundle still
// starts disconnected pre-hydration — a server/client text mismatch on this
// exact button (`CONNECT` vs `0x7099…`). React then discards and regenerates
// the whole client tree to recover, silently resetting in-flight form and
// wallet state. `ssr: true` defers reconnect to Hydrate's post-commit effect.
// The production runtime sets the same flag, for the same reason.
export const walletConfig: Config = createConfig({
  ssr: true,
  chains: [e2eChain],
  connectors: [
    mock({ accounts: [E2E_DEV_ACCOUNT], features: { defaultConnected: true, reconnect: true } }),
    mock({ accounts: [E2E_EMPTY_ACCOUNT], features: { defaultConnected: false, reconnect: false } }),
  ],
  transports: { [e2eChain.id]: http(rpcUrl) },
});

// No AppKit in E2E — nothing to initialise.
export function ensureWalletKit() {}

export function WalletButton() {
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const { connect, connectors } = useConnect();
  const connected = connection.status === "connected";
  const address = connection.addresses?.[0];
  const emptyConnector = connectors[1];
  const devConnector = connectors[0];

  return (
    <span className="wallet-identity">
      {connected ? (
        <>
          <CopyValue value={address ?? ""} display={formatAddress(address)} label="Copy wallet address" />
          <button className="button mono" type="button" onClick={() => disconnect()}>
            DISCONNECT
          </button>
        </>
      ) : (
        <button
          className="button mono"
          type="button"
          onClick={() => {
            if (devConnector) connect({ connector: devConnector });
          }}
        >
          CONNECT WALLET
        </button>
      )}
      {emptyConnector ? (
        <button
          className="button mono"
          type="button"
          data-ui="UI-E2E-USE-EMPTY-WALLET"
          onClick={() => {
            disconnect();
            connect({ connector: emptyConnector });
          }}
        >
          USE EMPTY WALLET
        </button>
      ) : null}
    </span>
  );
}
