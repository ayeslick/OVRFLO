---
title: "OVRFLO wrap / unwrap — underlying ↔ ovrfloToken primitive"
type: requirements
date: 2026-06-20
status: ready-for-planning
---

# OVRFLO wrap / unwrap — underlying ↔ ovrfloToken primitive

## Summary

Add a permissionless, exactly-1:1 `wrap` / `unwrap` primitive to the OVRFLO core.
`wrap` takes the series underlying and mints an equal amount of `ovrfloToken`; `unwrap`
burns `ovrfloToken` and returns an equal amount of underlying from a shared, on-contract
`wrappedUnderlying` reserve. No Sablier stream is created on either path. It exists to give
`ovrfloToken` holders a second, stream-independent exit to underlying, and to let the
protocol mint `ovrfloToken` from underlying to seed swap pools.

This is a **core change** (it mints/burns the `ovrfloToken` whose owner is the core, and the
core begins holding underlying). It is independent of the Secondary Market Book and must not
be folded into that plan.

## Problem Frame

Today an `ovrfloToken` holder has exactly two ways to realize value: let the Sablier stream
vest, or burn `ovrfloToken` for PT via `claim` **after maturity** (`src/OVRFLO.sol:327`).
There is no pre-maturity, stream-independent path from `ovrfloToken` back to underlying, and
no way for the protocol to create `ovrfloToken` from underlying (e.g. to provide one side of
a swap pool) without first acquiring and depositing PT.

`wrap` / `unwrap` adds that path. Because the protocol otherwise holds PT (not underlying)
and `deposit` fees route straight to treasury (`src/OVRFLO.sol:298`), the only underlying the
core ever holds for redemption is what wrappers themselves deposit — so `unwrap` liquidity is
intrinsically bounded by the wrap reserve.

## Decisions

- **D1. Permissionless, both audiences, one reserve per core.** Anyone (customer or the
  protocol) can `wrap`/`unwrap`. One OVRFLO core has one underlying and one `ovrfloToken`
  (cross-market fungibility under one underlying is an existing design feature), so there is a
  single `wrappedUnderlying` reserve per core.

- **D2. Exactly 1:1, no fee, in both directions.** `wrap(amount)` mints `amount` ovrfloToken
  for `amount` underlying; `unwrap(amount)` burns `amount` ovrfloToken for `amount`
  underlying. No bps fee on either path — keeps the peg tight and lets the protocol seed pools
  without leakage. Protocol revenue stays on the `deposit` path.

- **D3. `unwrap` is reserve-bounded and reverts when dry.** `unwrap` pays only from
  `wrappedUnderlying`; if the reserve cannot cover the request it reverts. There is no
  PT-selling, oracle/DEX dependency, queue, or partial fill. Consequence: the peg is **soft
  pre-maturity** (it can de-peg downward only under reserve stress and self-heals as wrappers
  add liquidity); the existing matured `claim` path remains the **hard 1:1 backstop**.

- **D4. Solvency invariant — unvested value stays locked.** 1:1 `unwrap` is safe because the
  streamed (unvested) portion of every deposit lives in Sablier, not in wallets. A holder can
  only `unwrap` `ovrfloToken` already in their wallet (vested + immediate payout), which by
  construction never exceeds current backing. The unvested remainder becomes spendable only as
  it vests, matching PT appreciation toward maturity.

- **D5. Claim/unwrap coexistence is fully fungible and first-come.** Wrap-minted ovrfloToken
  is not tied to any market and never writes `marketTotalDeposited` (`src/OVRFLO.sol:281,337`).
  ovrfloToken stays fungible; `claim` draws PT bounded per market by `marketTotalDeposited`,
  `unwrap` draws underlying bounded by `wrappedUnderlying`. No segregation is added. The system
  is solvent by construction:

  ```
  total ovrfloToken supply = Σ marketTotalDeposited[m]   (PT-backed, claimable)
                           + wrappedUnderlying            (underlying-backed, unwrappable)
  ```

  Every unit exits via exactly one of the two paths; whichever holder acts first takes the
  corresponding asset, and both paths revert when their backing pool is exhausted. Post-maturity
  the two assets are equivalent (PT redeems 1:1 to underlying), so routing is value-neutral.

## Scope

**In scope**
- `wrap` / `unwrap` external functions on the OVRFLO core and a `wrappedUnderlying` reserve.
- 1:1 mint/burn of `ovrfloToken` against the series underlying, no stream, no fee.
- Reserve-bounded `unwrap` with clean revert on insufficient reserve.

**Out of scope**
- Any change to `deposit` / `claim` pricing, fees, or the Sablier stream shape.
- PT-backed `unwrap`, or any mechanism that sources underlying by selling held PT.
- Oracle/DEX integration, unwrap queues, or partial fills.
- The Secondary Market Book (separate plan: `docs/plans/2026-06-20-001-feat-ovrflo-secondary-market-book-plan.md`).

## Dependencies / Assumptions

- One core ⇒ one underlying ⇒ one `ovrfloToken`, shared across that core's markets (existing
  design). `wrappedUnderlying` is a single per-core reserve.
- The core can mint/burn `ovrfloToken` (it is the token owner today via `OVRFLOToken`).
- Underlying decimals are not a special concern at launch (wstETH, 18 decimals); 1:1 mint/burn
  is decimal-trivial regardless.

## Outstanding Questions

- **Governance cap on `wrappedUnderlying`?** Supply is fully 1:1 backed, so a cap is a
  risk-appetite / blast-radius choice, not a solvency requirement. Decide at planning.
- **Admin pause on `wrap` (and/or `unwrap`)?** Weigh blast-radius control against the project's
  stated preference for minimal added surface.
- **Exact contract surface and reentrancy posture** — new externals on `src/OVRFLO.sol`,
  `wrappedUnderlying` storage var, guard/`SafeERC20` patterns — confirm during `/ce-plan`.

## Success Criteria

- A holder can `wrap` underlying → `ovrfloToken` and `unwrap` back at exactly 1:1 with no fee,
  no stream created.
- `unwrap` reverts cleanly when `wrappedUnderlying` cannot cover the request; never underflows
  the reserve.
- The supply invariant in D5 holds across arbitrary interleavings of `deposit`, `claim`,
  `wrap`, and `unwrap` (property/invariant test).
- No change to `deposit`/`claim` behavior or to the Book.

## Sources / Research

- Core: `src/OVRFLO.sol` — `deposit` mint + `marketTotalDeposited` bump (`:281,303-304`),
  `claim` burn + per-market PT accounting (`:327-341`), fee→treasury on deposit (`:298`),
  storage mappings (`:76-85`).
- Token ownership/mint/burn: `src/OVRFLOToken.sol`.
- Related (must stay decoupled): `docs/plans/2026-06-20-001-feat-ovrflo-secondary-market-book-plan.md`.
