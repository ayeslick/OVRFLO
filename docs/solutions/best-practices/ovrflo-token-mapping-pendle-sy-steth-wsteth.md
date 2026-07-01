---
title: ovrfloToken value mapping through Pendle SY (wstETH yield token, stETH asset)
date: 2026-07-01
last_updated: 2026-07-01
category: docs/solutions/best-practices/
module: OVRFLO
problem_type: best_practice
component: tooling
severity: low
applies_when:
  - Integrating with OVRFLO's wrap/unwrap or PT claim path and reasoning about token amounts
  - Debugging unexpected wstETH quantities when redeeming PT through Pendle's SY at maturity
  - Deciding which Pendle SY field (assetInfo vs yieldToken) to validate against OVRFLO's underlying
  - Evaluating whether stETH could replace wstETH as the vault underlying
tags: [pendle, sy, wsteth, steth, ovrflotoken, pt-redemption, exchange-rate, token-mapping]
---

# ovrfloToken value mapping through Pendle SY (wstETH yield token, stETH asset)

## Context

OVRFLO uses wstETH as its underlying asset. The wrap/unwrap path is 1:1 with wstETH. At maturity, users claim PT from OVRFLO (1 ovrfloToken = 1 PT) and redeem on Pendle. A common source of confusion: redeeming 1 PT for wstETH can return slightly less than 1 wstETH, which looks like a bug but is not. The cause is Pendle's SY accounting denomination, not a value discrepancy.

**Why wstETH is the correct underlying:** The tracking chain is ovrfloToken → PT → SY share → wstETH. PT tracks SY shares (1 PT = 1 SY share at maturity). The SY holds wstETH as its yield token — that is the actual asset in the vault. Since OVRFLO wraps PTs (1 ovrfloToken claims 1 PT at maturity), OVRFLO effectively tracks SY shares, which track wstETH. wstETH is therefore the correct underlying for the wrap/unwrap path. Pendle denominates the SY exchange rate in stETH (its `assetInfo` asset), but that is an accounting choice — the SY holds wstETH, and you can redeem for wstETH directly.

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

### SY lag is self-policing

The tiny token-count gap from SY exchange rate lag is actually beneficial for OVRFLO. The wrap → claim → Pendle redeem cycle costs a few bips (the SY lag), while wrap → unwrap costs nothing. This means there is no profitable arbitrage through the wrap/claim cycle — the SY lag nudges users toward unwrap (the hard-backed path) over claim+redeem, which is the safer dynamic for the wrap reserve. No one is forced to take the lossy path; the fungibility gives users the option to pick the best exit.

### Why stETH as underlying would break the 1:1

Using stETH (the SY's accounting asset) as the vault underlying instead of wstETH (the SY's yield token) would create a **22%+ value mismatch** between exit paths, not a 0.1% rounding gap:

- unwrap(1 ovrfloToken) = 1 stETH
- claim(1 ovrfloToken) = 1 PT = 1 SY = 1 wstETH in value = ~1.2287 stETH

The unwrap path gives 1 stETH but the claim path gives 1.2287 stETH. This transfers value from depositors (who put in 1 PT worth 1.2287 stETH but can only unwrap for 1 stETH) to wrappers (who put in 1 stETH but can claim 1 PT worth 1.2287 stETH). The 1:1 accounting in stETH is not value-consistent because 1 stETH is not worth 1 SY share.

Additionally, stETH is a rebasing token (balances grow via staking rewards, not per-token value), which creates a 1-2 wei rounding issue in the `wrap` function's strict `balanceAfter - balanceBefore == amount` check. wstETH avoids this entirely as a non-rebasing wrapper.

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

### On-chain verification (block 24609670)

Verified directly from the wstETH SY contract (`0xcbC72d92b2dc8187414F6734718563898740C0BC`):

| Field | Value | Meaning |
|-------|-------|---------|
| `assetInfo().assetAddress` | `0xae7a...312D7fE84` (stETH) | Accounting unit for exchange rate |
| `assetInfo().assetDecimals` | 18 | stETH decimals |
| `yieldToken()` | `0x7f39...C935E2Ca0` (wstETH) | What the SY actually holds |
| `exchangeRate()` | `1.2287e18` | 1 SY share = 1.2287 stETH at this block |
| `getTokensIn()` | ETH, WETH, stETH, wstETH | Accepted deposit tokens |
| `getTokensOut()` | stETH, wstETH | Redemption output tokens |

The exchange rate (1.2287 stETH per SY share) matches the wstETH/stETH rate at this block — the SY holds wstETH, so each share's stETH value tracks the wstETH-to-stETH conversion. This confirms 1 SY share = 1 wstETH in value, and therefore 1 PT = 1 wstETH in value at maturity.

The OVRFLO fork tests also verify these fields:

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
