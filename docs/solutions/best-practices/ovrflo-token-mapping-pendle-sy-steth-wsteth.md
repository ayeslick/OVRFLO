---
title: ovrfloToken value mapping through Pendle SY (wstETH yield token, stETH asset)
date: 2026-06-30
category: docs/solutions/best-practices/
module: OVRFLO
problem_type: best_practice
component: tooling
severity: low
applies_when:
  - Integrating with OVRFLO's wrap/unwrap or PT claim path and reasoning about token amounts
  - Debugging unexpected wstETH quantities when redeeming PT through Pendle's SY at maturity
  - Deciding which Pendle SY field (assetInfo vs yieldToken) to validate against OVRFLO's underlying
tags: [pendle, sy, wsteth, steth, ovrflotoken, pt-redemption, exchange-rate, token-mapping]
---

# ovrfloToken value mapping through Pendle SY (wstETH yield token, stETH asset)

## Context

OVRFLO uses wstETH as its underlying asset. The wrap/unwrap path is 1:1 with wstETH. At maturity, users claim PT from OVRFLO (1 ovrfloToken = 1 PT) and redeem on Pendle. A common source of confusion: redeeming 1 PT for wstETH can return slightly less than 1 wstETH, which looks like a bug but is not. The cause is Pendle's SY accounting denomination, not a value discrepancy.

## Guidance

Pendle's wstETH SY has two distinct fields that matter for OVRFLO:

- **`assetInfo().assetAddress`** returns `stETH` — this is the asset Pendle uses to denominate the SY exchange rate. `exchangeRate() * syBalance / 1e18` yields stETH, not wstETH.
- **`yieldToken()`** returns `wstETH` — this is the yield-bearing token the SY holds internally.

OVRFLO's factory validates against `yieldToken()`, not `assetInfo().assetAddress`:

```solidity
require(IStandardizedYield(sy).yieldToken() == info.underlying, "OVRFLOFactory: underlying mismatch");
```

This is intentional: OVRFLO's underlying is wstETH (the yield token), and the wrap/unwrap path is 1:1 with wstETH. Pendle's choice to denominate the exchange rate in stETH is Pendle's accounting decision — it does not affect ovrfloToken's value mapping.

## Why This Matters

At maturity, 1 PT = 1 SY share. The SY exchange rate is in stETH terms:

```
1 PT = 1 SY share = exchangeRate() / 1e18 stETH
```

When you redeem for wstETH (choosing wstETH as `tokenOut`), the SY converts stETH to wstETH at the current wstETH/stETH rate:

```
wstETH received = (exchangeRate() / 1e18) / (wstETH-to-stETH rate)
```

If the exchange rate perfectly tracks the wstETH/stETH rate, you get exactly 1 wstETH per PT. In practice the SY exchange rate updates periodically (not every block), so it can lag slightly. The wstETH token count may be marginally below 1, but the **value** is always exactly 1 PT — whether measured in wstETH or stETH.

This is not a bug and does not mean ovrfloToken is not 1:1 with wstETH. The 1:1 value relationship holds three ways:

1. **Wrap/unwrap** (hard peg): 1 wstETH in = 1 ovrfloToken out, 1 ovrfloToken in = 1 wstETH out
2. **PT claim at maturity**: 1 ovrfloToken = 1 PT (exact, 1:1 token count)
3. **PT redemption on Pendle**: 1 PT = 1 SY share = equivalent value in wstETH or stETH

The token count may differ across units (0.999 wstETH = 1.1488 stETH = 1 PT), but the value is identical in every unit. wstETH is a more valuable unit than stETH (1 wstETH > 1 stETH because wstETH wraps stETH shares that accrue staking rewards), so the wstETH token count is lower for the same value.

## When to Apply

- When an integrator or user reports receiving "less wstETH than expected" from PT redemption
- When deciding which Pendle SY field to validate against OVRFLO's configured underlying
- When explaining the ovrfloToken → PT → wstETH/stETH value chain to new developers
- When reasoning about whether ovrfloToken is truly 1:1 with wstETH

## Examples

### Real example (approximate 2025 rates)

- 1 wstETH = 1.15 stETH
- SY exchange rate (perfectly tracking) = 1.15e18

**Perfectly tracking:**
```
1 PT = 1 SY = 1.15 stETH = 1.15 / 1.15 = 1.000 wstETH
```
No discrepancy.

**SY lags by 0.1%** (exchange rate updates periodically):
```
exchange rate = 1.1488e18
1 PT = 1.1488 stETH = 1.1488 / 1.15 = 0.9990 wstETH
```
You get 0.999 wstETH instead of 1.0, but 0.999 wstETH is worth 0.999 x 1.15 = 1.1488 stETH, which is exactly 1 PT's value. The gap is under 10 basis points in practice.

### Fork test confirmation

The OVRFLO fork tests verify the SY's field values on-chain:

```solidity
(, address assetAddress,) = IStandardizedYield(sy).assetInfo();
address yieldToken = IStandardizedYield(sy).yieldToken();

assertEq(sy, WSTETH_SY);
assertEq(assetAddress, STETH);    // Pendle denominates in stETH
assertEq(yieldToken, WSTETH);     // OVRFLO's underlying matches yield token
```

### Factory validation

```solidity
// OVRFLOFactory.sol — checks yieldToken, not assetInfo
require(IStandardizedYield(sy).yieldToken() == info.underlying, "OVRFLOFactory: underlying mismatch");
```

OVRFLO's underlying is wstETH, matching the SY's yield token. Pendle's asset (stETH) is one layer below — the SY handles the stETH/wstETH conversion internally, and OVRFLO never interacts with stETH directly.

## Related

- [`docs/solutions/patterns/ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md) — pattern #9 (factory as single admin), pattern #10 (duplicate underlying prevention)
- [`src/OVRFLOFactory.sol`](../../src/OVRFLOFactory.sol) — `addMarket` SY validation
- [`test/fork/OVRFLOFactoryMainnetFork.t.sol`](../../test/fork/OVRFLOFactoryMainnetFork.t.sol) — on-chain SY field assertions
- [`interfaces/IStandardizedYield.sol`](../../interfaces/IStandardizedYield.sol) — Pendle SY interface (`assetInfo`, `yieldToken`, `exchangeRate`, `getTokensOut`)
