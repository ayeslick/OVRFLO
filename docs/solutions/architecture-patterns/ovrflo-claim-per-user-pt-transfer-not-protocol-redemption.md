---
title: OVRFLO claim keeps per-user PT transfer, not protocol-level PT-to-SY-to-underlying redemption
date: 2026-06-29
category: docs/solutions/architecture-patterns
module: OVRFLO Core
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Deciding whether to replace the per-user claim() mechanism with protocol-level PT redemption in the OVRFLO vault"
  - "Evaluating whether the vault should redeem PT on behalf of users instead of transferring PT 1:1 and letting users redeem on Pendle themselves"
  - "Investigating Pendle PT redemption mechanics and the stETH/wstETH exchange-rate relationship for wstETH-backed markets"
  - "Preserving the 1:1 supply invariant between ovrfloToken and the underlying asset during a claim-path redesign"
  - "Auditing the claim flow for rebasing-asset variance or minTokenOut handling complexity"
symptoms:
  - "redeemPY is on the YieldToken (YT), not the PrincipalToken (PT) — the YT's redeem function must be used"
  - "burnFromInternalBalance must be false for the SY redemption to work"
  - "PT redemption is 1:1 for the accounting asset (stETH), not the yield token (wstETH); 10 PT redeems to ~8.138 wstETH, breaking the 1:1 supply invariant"
  - "Variable stETH-to-wstETH exchange rate (~1.2x) requires complex minTokenOut handling"
  - "Protocol-level redemption adds stETH rebasing variance, factory restructuring, and minTokenOut fuzziness"
tags: [ovrflo, claim, pt-redemption, pendle, wsteth, steth, supply-invariant, architecture]
related_components: [src/OVRFLO.sol, src/OVRFLOFactory.sol, interfaces/IPPrincipalToken.sol, interfaces/IStandardizedYield.sol]
---

# OVRFLO claim keeps per-user PT transfer, not protocol-level PT-to-SY-to-underlying redemption

> **Decision:** The OVRFLO vault keeps its simple per-user `claim()` (burn ovrfloToken, transfer PT 1:1). A protocol-level PT-to-SY-to-underlying redemption was attempted, fork-tested against real Pendle mainnet markets, and abandoned after three critical issues. This documents the decision and the technical findings so it is not re-attempted.

## Context

The OVRFLO vault (`src/OVRFLO.sol`) lets users deposit a Pendle Principal Token (PT) and receive a 1:1 ovrfloToken plus a Sablier stream distributing excess yield. At PT maturity, users exit by calling `claim()`, which burns their ovrfloToken and returns the PT 1:1. The user then redeems that PT on Pendle themselves (PT to SY to underlying).

A redesign was proposed to remove the user's Pendle interaction entirely: the vault would call Pendle's SY `redeemPY` (or equivalent) at the protocol level to convert PT straight to the underlying asset (e.g. wstETH) and send that to the user. The intention was a smoother exit and a single asset returned.

The redesign was implemented on a `feat/redeem-matured-pt` branch and fork-tested against real Pendle mainnet markets. Three critical issues surfaced (detailed in *Examples* and *Why This Matters*). The decisive one: PT redemption through the SY is 1:1 against the **accounting asset** (stETH), not the **yield token** (wstETH), so 10 PT redeems to ~8.138 wstETH once the variable stETH-to-wstETH exchange rate is applied. That breaks the fundamental 1:1 supply invariant between ovrfloToken and the underlying (wstETH).

After review the redesign was abandoned. The `feat/redeem-matured-pt` branch was reset to base and deleted entirely; the working tree was reverted to the pre-redesign state. The current per-user `claim()` is the correct mechanism.

### Historical design context (session history)

The per-user `claim()` design was intentional from the start (session history, 2026-06-23). The original planning session treated `claim()` as a fixed design: burn ovrfloToken, hand back PT, user redeems on Pendle. Wrap/unwrap was added as a **separate** 1:1 exit path (underlying to ovrfloToken, no stream, no fee) with its own `wrappedUnderlying` reserve that never touches `marketTotalDeposited` or PT accounting. The user's framing: "adding a wrapping and unwrapping would have it holding underlying... This enables yet another way for customers to claim as they see fit."

The supply invariant was explicitly documented as load-bearing: `supply == sum(marketTotalDeposited) + wrappedUnderlying`. The 1:1 peg was described as foundational, not optional: "1 OVRFLO = 1 underlying holds before maturity or OVRFLO doesnt work. Thats the point of making it overcollateralized." PT redemption was treated as Pendle's settlement guarantee, not something OVRFLO should internalize: "If PT-wstETH doesnt redeem properly theres nothing this protocol can do about that since its Pendle's product."

## Guidance

**Practice:** Keep the per-user `claim()` with a 1:1 PT transfer. Do not move PT-to-underlying redemption into the vault. Users redeem PT on Pendle on their own terms.

The current implementation in `src/OVRFLO.sol`:

```solidity
function claim(address ptToken, uint256 amount) external {
    address market = ptToMarket[ptToken];
    require(market != address(0), "OVRFLO: unknown PT");

    SeriesInfo storage info = _series[market];
    require(block.timestamp >= info.expiryCached, "OVRFLO: not matured");
    require(amount > 0, "OVRFLO: amount is zero");

    uint256 currentDeposited = marketTotalDeposited[market];
    require(currentDeposited >= amount, "OVRFLO: deposit accounting");
    marketTotalDeposited[market] = currentDeposited - amount;

    OVRFLOToken(ovrfloToken).burn(msg.sender, amount);
    IERC20(ptToken).safeTransfer(msg.sender, amount);

    emit Claimed(msg.sender, market, ptToken, ovrfloToken, amount);
}
```

Why this is the right approach:

- **1:1 invariant preserved.** `burn(msg.sender, amount)` then `safeTransfer(ptToken, amount)` keeps ovrfloToken supply and PT backing exactly aligned. No rate math, no slippage, no `minTokenOut` to estimate.
- **No rebasing exposure in the vault.** The vault never holds or accounts for the rebasing accounting asset (stETH); it only ever custody-transfers the non-rebasing PT.
- **Minimal contract surface.** No new Pendle SY/YT integration code, no extra factory parameters, no extra validation paths. The vault stays Pendle-specific and thin.
- **User flexibility.** The user chooses when and how to redeem PT to SY to underlying on Pendle, including routing through whichever token the SY exposes.

Do **not** add a protocol-level redemption path. If a smoother UX is desired later, build it as an off-chain or zap-layer concern, never as a vault accounting change.

## Why This Matters

The redesign was not killed by complexity alone; it was killed by a hard accounting incompatibility. The key technical insight:

> **PT redemption through the SY is 1:1 for the accounting asset (stETH), not the yield token (wstETH).**

For a wstETH Pendle market, the SY's accounting asset is stETH and its yield token is wstETH. Redeeming 10 PT yields 10 stETH, which at the variable stETH-to-wstETH rate (~1.2x at time of testing) is only ~8.138 wstETH. OVRFLO's `underlying` is wstETH, and the entire wrap/unwrap/claim design assumes a 1:1 ovrfloToken-to-underlying relationship. A protocol-level redemption that returns ~0.81x of the expected underlying amount would silently break that invariant for every claim.

The 1:1 supply invariant (`supply == sum(marketTotalDeposited) + wrappedUnderlying`) is load-bearing (session history). Wrap/unwrap preserves it by keeping a separate reserve. A protocol-level claim redesign that redeemed PT to a different asset (stETH instead of wstETH) would collapse the two-pool separation and break the invariant the wrap path depends on.

Additional reasons the redesign was rejected even setting the rate issue aside:

- **Rebasing variance complicates accounting.** stETH rebases daily; vault balances and `marketTotalDeposited` would drift, requiring rebase-aware accounting that the current PT-custody model avoids entirely.
- **Factory restructuring required.** To return the correct asset, the factory would need to pass `yieldToken` separately and validate both `SY.yieldToken()` and `SY.assetInfo().assetAddress`. The current setup (wstETH as `underlying`, validated via `yieldToken() == underlying`) is correct and works because wstETH is one of the SY's redeemable tokens; restructuring it adds surface area for no benefit.
- **`minTokenOut` estimation.** A variable exchange rate means the vault would need fuzzy/slippage-tolerant output estimation for the redemption, another failure mode and another parameter to govern.

The user's understanding evolved during the investigation: an initial "it's ETH all the way down" hypothesis suggested treating stETH (the accounting asset) as `underlying`. That was walked back: the current wstETH-as-`underlying` setup is correct and works, because wstETH is a valid redeemable token of the SY. The fix was not to change `underlying`; it was to not redeem at the protocol level at all.

The old approach is simpler and correct: burn ovrfloToken, transfer PT 1:1, let the user handle PT-to-underlying on Pendle.

## When to Apply

- When considering whether to move PT redemption from the user side to the protocol (vault) side.
- When designing vault exit mechanisms for Pendle PT positions, especially for markets where the SY's accounting asset differs from its yield token (e.g. stETH vs wstETH).
- When tempted to "smooth" the user exit by having the vault call `redeemPY` / SY redemption directly.
- When evaluating whether a rebasing accounting asset should enter vault accounting.

If any of these apply, re-read this decision first: the 1:1-accounting-asset-not-yield-token behavior is the load-bearing reason the redesign was abandoned.

## Examples

### 1. Current `claim()` — simple burn and transfer (KEEP)

```
user calls claim(ptToken, 10)
  -> burn 10 ovrfloToken from user
  -> transfer 10 PT to user
  -> user redeems 10 PT on Pendle themselves
```

Invariant intact: 10 ovrfloToken burned == 10 PT transferred. The vault never touches the underlying or the accounting asset.

### 2. Attempted protocol-level redemption — three issues encountered (ABANDON)

- **(a) `redeemPY` lives on the YieldToken (YT), not the PrincipalToken (PT).** The first implementation called `redeemPY` on the PT contract and failed. Pendle's API puts the redeem entrypoint on the YT, so the code had to be restructured to route through the YT's redeem function.
- **(b) `burnFromInternalBalance` must be `false`.** The SY redemption takes a `burnFromInternalBalance` flag. Setting it `true` failed because the vault holds no internal balance in the SY; `false` was required for the external redemption path.
- **(c) PT redemption is 1:1 for the accounting asset, not the yield token (the dealbreaker).** See example 3.

### 3. The 1:1 invariant and where it breaks

```
Current (correct):
  10 ovrfloToken --claim()--> 10 PT --user redeems--> 10 stETH --rate--> ~8.138 wstETH
  (vault only does the first arrow; 1:1 ovrfloToken-to-PT is preserved)

Attempted protocol redemption (broken):
  10 ovrfloToken --vault redeems--> 10 stETH --rate--> ~8.138 wstETH sent to user
  (vault returns ~0.81x of the wstETH the 1:1 invariant promises; silent accounting break)
```

The user still ends up with the same economic value either way, but only the current approach keeps the on-chain 1:1 ovrfloToken-to-PT-to-underlying-wstETH invariant that the wrap/unwrap reserve and all other accounting depend on.

## Related

- `CONCEPTS.md` — Claim entry (claim capacity bounded by PT backing), PT entry, ovrfloToken entry, Wrap/Unwrap entries.
- `docs/solutions/architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md` — two-pool accounting model and the supply invariant this decision preserves.
- `docs/solutions/security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md` — security analysis that rests on claim remaining "burn ovrfloToken, transfer PT 1:1".
- `docs/solutions/patterns/ovrflo-critical-patterns.md` — enforceable rules, including the cross-market ovrfloToken fungibility / 1:1 invariant under one underlying.
- `src/OVRFLO.sol` — `claim()` (the kept mechanism) and the wrap/unwrap reserve that depends on the 1:1 invariant.
