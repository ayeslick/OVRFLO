// KTD6: the E2E-only wagmi mock connector itself lives in `lib/wagmi.ts`
// (`walletConfig` in tests/e2e/support/WalletRuntime.tsx, selected by the
// build-time `wallet-runtime` alias under E2E_WALLET_RUNTIME=1) — it auto-connects on page
// load via wagmi's own reconnect-on-mount, so no scenario ever has to drive
// the real Connect-Wallet/WalletConnect UI. This file is the Playwright-side
// half: the well-known addresses step definitions assert against and arrange
// on-chain state for, plus a small wait helper for the one observable signal
// that auto-connect actually happened.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Address } from "viem";
import { formatAddress } from "@/lib/format";

// Must stay in lockstep with `lib/wagmi.ts`'s E2E_DEV_ACCOUNT and
// `script/seed-local.sh`'s $DEV_WALLET/$LENDER_WALLET defaults — all four are
// Anvil's well-known dev-mnemonic accounts #1 and #2, unlocked and signed for
// internally by Anvil on every local fork. Never funded on any real chain and
// never associated with a private key anywhere in this codebase.
export const DEV_WALLET_ADDRESS: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const LENDER_WALLET_ADDRESS: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
// Anvil account #3 — lockstep with tests/e2e/support/WalletRuntime.tsx E2E_EMPTY_ACCOUNT.
export const EMPTY_WALLET_ADDRESS: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

// Every scenario's Background waits on this rather than assuming connection —
// the mock connector's `defaultConnected` flag only starts the reconnect
// handshake; it isn't synchronous with first paint.
export async function waitForWalletConnected(page: Page, address: Address = DEV_WALLET_ADDRESS) {
  await expect(page.getByRole("button", { name: formatAddress(address) })).toBeVisible();
}
