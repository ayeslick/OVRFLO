---
title: OVRFLO wrap/unwrap reserve accounting
date: 2026-06-23
category: architecture-patterns
module: OVRFLO Core
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Implementing or changing OVRFLO wrap/unwrap, underlying reserve accounting, or ovrfloToken redemption paths"
  - "Evaluating whether deposit-origin ovrfloToken can consume wrap reserve"
  - "Adding admin sweep or recovery for accidentally donated underlying above the wrap reserve"
tags:
  - wrap-unwrap
  - wrapped-underlying
  - ovrflo-token
  - reserve-accounting
  - fungibility
  - pendle
  - sablier
related_components:
  - src/OVRFLO.sol
  - src/OVRFLOFactory.sol
  - interfaces/IOvrfloAdmin.sol
  - test/OVRFLOWrapUnwrap.t.sol
  - test/OVRFLOWrapUnwrap.invariant.t.sol
  - test/fork/OVRFLOWrapUnwrapFork.t.sol
---

# OVRFLO wrap/unwrap reserve accounting

## Context

OVRFLO originally minted `ovrfloToken` through PT deposits: users deposited Pendle PT, received the current PT market value immediately, and received the discount through a Sablier stream. After maturity, holders burned `ovrfloToken` through `claim` to receive PT, bounded by per-market `marketTotalDeposited`.

The wrap/unwrap feature adds a parallel permissionless path: underlying goes in, `ovrfloToken` comes out 1:1, and `ovrfloToken` can be burned back to underlying 1:1 without fees or streams. Because PT deposits do not put underlying into the vault, unwrap liquidity must be bounded by underlying that wrappers actually deposited. OVRFLO tracks that backing with `wrappedUnderlying`, separate from PT deposit accounting.

Factory deployment now records the canonical `(treasury, underlying, ovrfloToken)` tuple in `ovrfloInfo`, exposed through `IOvrfloAdmin`. The core reads this tuple for `wrap` and `unwrap`, so the user flow does not require a market argument.

## Guidance

Maintain two independent accounting pools behind the same fungible `ovrfloToken`:

| Pool | Counter | Exit path | Asset out |
| --- | --- | --- | --- |
| PT deposits | `marketTotalDeposited[market]` | `claim(ptToken, amount)` after maturity | PT |
| Underlying wraps | `wrappedUnderlying` | `unwrap(amount)` anytime | underlying |

The core solvency invariant is:

```text
ovrfloToken.totalSupply() == sum(marketTotalDeposited[market]) + wrappedUnderlying
```

The shipped invariant test currently checks the single-market case while interleaving deposits, claims, wraps, unwraps, and excess sweeps.

`unwrap` capacity must come from the counter, not the token balance:

```solidity
uint256 reserve = wrappedUnderlying;
require(reserve >= amount, "OVRFLO: insufficient reserve");

wrappedUnderlying = reserve - amount;
OVRFLOToken(ovrfloToken).burn(msg.sender, amount);
IERC20(underlying).safeTransfer(msg.sender, amount);
```

Direct underlying donations therefore do not increase unwrap capacity. They sit above `wrappedUnderlying` and can be recovered only through the admin sweep path:

```solidity
uint256 balance = IERC20(underlying).balanceOf(address(this));
uint256 reserve = wrappedUnderlying;
uint256 excess = balance > reserve ? balance - reserve : 0;

require(excess > 0, "OVRFLO: no excess");
IERC20(underlying).safeTransfer(to, excess);
```

`wrap` should verify the actual inbound transfer amount before minting, so fee-on-transfer or short-transfer underlying cannot create under-backed `ovrfloToken`:

```solidity
uint256 balanceBefore = IERC20(underlying).balanceOf(address(this));
IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
uint256 balanceAfter = IERC20(underlying).balanceOf(address(this));
require(
    balanceAfter >= balanceBefore && balanceAfter - balanceBefore == amount,
    "OVRFLO: transfer amount mismatch"
);

wrappedUnderlying += amount;
OVRFLOToken(ovrfloToken).mint(msg.sender, amount);
```

Keep `deposit` and `claim` unchanged by this feature:

- `deposit` increments `marketTotalDeposited`, mints the TWAP split, and creates the Sablier stream.
- `claim` decrements `marketTotalDeposited`, burns `ovrfloToken`, and sends PT.
- `wrap` and `unwrap` do not touch PT counters, Pendle markets, or Sablier streams.

## Why This Matters

The same `ovrfloToken` is intentionally fungible across origins. A PT depositor may unwrap if independent wrapper liquidity exists, and a wrapper may claim PT after maturity if PT backing exists. This preserves the product-level design of one fungible token per underlying instead of fragmenting liquidity by source or series.

That fungibility is safe only if each exit path is bounded by the backing it actually consumes. Using `IERC20(underlying).balanceOf(address(this))` as unwrap capacity would let donations or accidental transfers expand redeemability without a corresponding mint path, obscuring solvency and making admin recovery unsafe. Using `wrappedUnderlying` makes unwrap capacity explicit and auditable.

The 1:1 no-fee design also preserves the security analysis for flash-loan wrap → claim → Pendle redeem displacement: the cycle is value-neutral because the wrap leg self-provisions the alternative underlying exit. See the related security analysis for the threat-model details.

## When to Apply

- When OVRFLO wrap/unwrap logic changes.
- When adding another mint or burn path for `ovrfloToken`.
- When reviewing sweep or recovery logic for accidentally transferred assets.
- When reasoning about whether a token holder's origin should restrict redemption paths.
- When extending invariant tests around `ovrfloToken` backing.

Do not apply this pattern to designs where unwrap should consume donated assets, sell PT for underlying, charge unwrap fees, or apply slippage. Those would be different product and solvency models and would require revisiting the security analysis.

## Examples

### 1:1 wrap round-trip

```solidity
ovrflo.wrap(10 ether);   // +10 wrappedUnderlying, +10 ovrfloToken
ovrflo.unwrap(10 ether); // -10 wrappedUnderlying, -10 ovrfloToken
```

The round-trip restores balances, pays no treasury fee, and creates no Sablier stream.

### Donation does not increase unwrap capacity

```solidity
// After wrap(5 ether): wrappedUnderlying == 5
IERC20(underlying).transfer(address(ovrflo), 5 ether);

// balanceOf == 10, but wrappedUnderlying == 5
// Caller holds at least 6 ovrfloToken from any mint path.
ovrflo.unwrap(6 ether); // reverts: "OVRFLO: insufficient reserve"
```

The donated amount is recoverable via `sweepExcessUnderlying`, while the 5 ether reserve remains available for unwrap.

### Deposit-origin holder can consume independent wrap reserve

```solidity
// WRAPPER wraps 0.5 wstETH and funds wrappedUnderlying.
// USER deposits PT and receives ovrfloToken from the deposit path.
// USER holds at least 0.5 ovrfloToken, and reserve is 0.5 wstETH.
ovrflo.unwrap(0.5 ether);
```

The user's unwrap consumes the wrapper-funded reserve. `marketTotalDeposited` remains unchanged, so PT claim accounting is still intact.

## Related

- `docs/solutions/security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md` — threat-model analysis for flash-loan wrap → claim → Pendle redeem displacement.
- `docs/plans/2026-06-20-002-feat-ovrflo-wrap-unwrap-plan.md` — original implementation plan for the shipped feature.
- `docs/brainstorms/2026-06-20-ovrflo-core-token-underlying-requirements.md` — rationale for sourcing the canonical pair from factory `ovrfloInfo`.

## Tests and Review Checklist

Keep these checks around any future change to this feature:

- Unit test 1:1 wrap minting, underlying pull, reserve increment, and `Wrapped` event.
- Unit test 1:1 unwrap burn, underlying return, reserve decrement, and `Unwrapped` event.
- Unit test zero amounts, insufficient reserve, short-transfer underlying, donated underlying, shared reserve, reentrancy during unwrap, and factory sweep.
- Invariant test `ovrfloToken.totalSupply() == marketTotalDeposited + wrappedUnderlying`.
- Invariant test `wrappedUnderlying <= underlying.balanceOf(address(ovrflo))`.
- Fork test real wstETH round-trip and donation sweep.
- Review that unwrap capacity never uses raw underlying `balanceOf`.
- Review that every new mint/burn path preserves or deliberately updates the backing invariant.
