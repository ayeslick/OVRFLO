// KTD6: the E2E-only wagmi mock connector lives in
// tests/e2e/support/WalletRuntime.tsx (Turbopack `wallet-runtime` alias under
// E2E_WALLET_RUNTIME=1). Backgrounds click CONNECT WALLET; this helper waits
// for the masthead chip. Do not query the chip on the whole page — Assets
// wrap destination uses the same truncated address as a second CopyValue.
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

// Every scenario's Background waits on this rather than assuming connection.
// The masthead chip is the signal; Assets may render the same truncated
// address as a wrap-destination CopyValue.
export async function waitForWalletConnected(page: Page, address: Address = DEV_WALLET_ADDRESS) {
  await expect(walletIdentity(page).getByRole("button", { name: formatAddress(address) })).toBeVisible({
    timeout: 15_000,
  });
}

export function walletIdentity(page: Page) {
  return page.locator(".wallet-identity");
}
