import { describe, expect, it } from "vitest";

// The production wallet stack had no coverage in any tier: E2E swapped it out
// wholesale, and no unit test imported it. That is how `ssr` went missing from
// the adapter without anything going red. These tests exist to make the
// production config assertable at all — they are cheap, and their absence was
// the actual defect.
import { wagmiAdapter, wagmiConfig } from "@/lib/wagmi";
import { walletConfig } from "wallet-runtime";

type InternalConfig = { _internal: { ssr?: boolean } };

describe("production wagmi config", () => {
  it("sets ssr, so reconnect runs in an effect rather than during render", () => {
    // Without this, wagmi's `Hydrate` calls `onMount()` in the render body, and
    // `reconnect()` does a synchronous `setState({ status: 'connecting' })`
    // before its first await — a store write during render, on the exact field
    // WalletButton renders on. It also runs during the build-time prerender
    // pass: `output: "export"` removes the runtime server, not the render pass.
    expect((wagmiConfig as unknown as InternalConfig)._internal.ssr).toBe(true);
  });

  it("passes ssr through the Reown adapter, not just to a config we construct", () => {
    // WagmiAdapter spreads its constructor params into `createConfig`, so the
    // flag has to be set on the adapter. Asserting the adapter's own config
    // rather than a re-export pins the thing that actually reaches wagmi.
    expect((wagmiAdapter.wagmiConfig as unknown as InternalConfig)._internal.ssr).toBe(true);
  });

  it("is the exact config the wallet runtime hands to WagmiProvider", () => {
    // If these ever diverge, connections made through the AppKit modal never
    // propagate to the app's wagmi hooks — the classic Reown footgun.
    expect(walletConfig).toBe(wagmiConfig);
  });

  it("targets exactly one chain, matching the configured chain id", () => {
    expect(wagmiConfig.chains).toHaveLength(1);
    expect(wagmiConfig.chains[0].id).toBe(1);
  });
});
