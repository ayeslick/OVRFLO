---
module: OVRFLO Core
date: 2026-06-22
problem_type: security_analysis
component: solidity_contracts
symptoms:
  - "An attacker could flash-loan underlying, wrap to ovrfloToken, claim a matured series' PT, and redeem that PT on Pendle to drain the core's PT for a given series"
  - "Concern that this displaces honest depositors from claiming their PT (claim griefing)"
root_cause: no_issue_by_design
resolution_type: no_action_needed
severity: informational
tags: [flash-loan, griefing, wrap-unwrap, pendle, claim, peg, value-neutral, audit-note]
---

# Analysis: flash-loan wrap → claim → Pendle-redeem "claim displacement" is a non-issue

## Suspected attack

With the planned `wrap`/`unwrap` primitive (underlying ⇄ ovrfloToken at 1:1, no
stream) plus the existing post-maturity `claim` path, an attacker could, in a
single transaction:

1. Flash-loan `X` underlying.
2. `wrap(X)` → mint `X` ovrfloToken (1:1).
3. `claim(ptToken, X)` on a **matured** series → burn `X` ovrfloToken, receive
   `X` PT, draining that series' PT pool by `X`.
4. Redeem the `X` PT on Pendle for `X` underlying (1:1, fee-free post-maturity).
5. Repay the flash loan.

Stated goal: **prevent honest depositors from claiming their PT** (a griefing
/ liveness attack), or extract value.

## Conclusion: not an issue

This is value-neutral, self-provisioning, and unprofitable. It costs the
attacker gas (and a flash-loan fee) for no gain and does not deprive honest
users of value.

### 1. Value-neutral identity at maturity

At maturity every leg is 1:1 and fee-free (gas aside):

```
1 ovrfloToken  ==  1 PT (claim)  ==  1 underlying (Pendle redeem)  ==  1 underlying (unwrap)  ==  wrap cost
```

No cycle nets positive. Any round-trip returns the attacker to their starting
balance minus gas.

### 2. The attack self-provisions the alternative exit

`claim` removes `X` PT from the core, **but** the `wrap` leg deposited `X`
underlying into the wrap reserve. Honest holders displaced from the PT-form of
redemption can still realize full 1:1 value via `unwrap` (ovrfloToken →
underlying) — which is now liquid precisely *because the attacker funded it*.
So the attack can only change the *form* a holder redeems in (PT vs.
underlying), never the *value*. For matured PT, those two are identical (1:1),
so there is no economic harm — at most a holder gets underlying instead of PT,
which is what redeeming the PT would have given them anyway.

### 3. No profitable variant exists (no AMM round-trip)

There is no second hop to add margin:

- Pendle's AMM is **disabled post-expiry**; matured PT can only be redeemed
  1:1, not swapped.
- There is **no cross-series swapping** — each series' PT redeems only on its
  own Pendle market.
- A constant-product (Uniswap-style) PT↔ovrfloToken or PT↔underlying pool is
  **economically unviable** (PT converges deterministically to par, making such
  a pool a perpetual arbitrage target that bleeds LPs), so no usable liquidity
  exists there. This is the same reason a PT-wstETH ⇄ wstETH Uniswap pool
  doesn't exist — and is essentially why Pendle built its own AMM.

Because the only exit for a matured PT is Pendle's fee-free 1:1 redemption, the
attacker's option set is fully enumerated and closes back to the value-neutral
identity above.

### 4. Cost asymmetry favors honest users

To *sustain* displacement the attacker must keep paying flash-loan fees + gas
every block. The instant they stop, on-chain state is unchanged for honest
users (their value was never impaired), and the displaced PT can simply be
re-acquired by anyone depositing again. There is no durable denial and no
profit motive.

## Trust assumptions this rests on

- **Pendle settles matured PT 1:1, fee-free.** This is a core OVRFLO axiom — the
  entire peg (every `claim`) depends on it, not just this path. PT redemption is
  Pendle's product; if it ever failed, it would break the whole core, so it is a
  trusted external dependency, not a per-feature risk. PT-wstETH has settled at
  par across Pendle's matured markets to date.
- **`unwrap` is 1:1 with no fee/slippage** (per the wrap/unwrap plan). If a fee
  or slippage were ever added to `unwrap`, the value-neutral identity would break
  and this analysis must be revisited.

## What the wrap reserve cap is (and isn't) for

The `wrap` reserve cap (wrap/unwrap plan, KTD8) bounds how much can be displaced
at once. It is a **risk-appetite lever, not a solvency guarantee** — solvency is
already guaranteed by the 1:1 reserve backing and fungibility. The cap exists so
the multisig can throttle the maximum size of this (benign) churn, not because
uncapped wrapping is unsafe.

## What would change this conclusion

Re-open this analysis if any of the following becomes true:

1. A future underlying's PT does **not** redeem 1:1 fee-free at maturity (e.g.
   redemption haircut, depeg window, or non-instant settlement) — gated by the
   wrap/unwrap plan's KTD6 underlying-eligibility criteria.
2. `unwrap` gains a fee or any path introduces slippage, breaking the 1:1
   identity.
3. A liquid PT↔ovrfloToken (or post-expiry PT↔underlying) AMM appears, enabling a
   profitable round-trip rather than a value-neutral one.

## Related

- Plan: `docs/plans/2026-06-20-002-feat-ovrflo-wrap-unwrap-plan.md` (wrap/unwrap,
  reserve cap KTD8, underlying eligibility KTD6)
- Plan: `docs/plans/2026-06-20-001-feat-ovrflo-secondary-market-book-plan.md`
  (maturity guard in eligibility; shares the same peg assumptions)
