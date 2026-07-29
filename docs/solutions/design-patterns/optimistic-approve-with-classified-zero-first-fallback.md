---
title: Optimistic approve with a classified zero-first fallback
date: 2026-07-29
category: design-patterns
module: web/hooks/useZeroFirstApprove.ts
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Re-approving an ERC-20 allowance that may already be non-zero
  - The set of tokens the app touches is known and controlled
  - Weighing a defensive extra transaction against a failure that is observable and recoverable
tags: [erc20, approve, allowance, usdt, gas, wagmi, fallback]
---

# Optimistic approve with a classified zero-first fallback

## Context

Some ERC-20 implementations (USDT is the canonical one) revert when a non-zero
allowance is changed directly to another non-zero value. The textbook fix is to
always approve `0` first, then the target amount — two transactions and two
wallet signatures on every re-approve.

Audit requirement R28 / finding L-3 asked for that unconditional sequence. It
was rejected as written: OVRFLO's vaults are wstETH-underlying, wstETH is a
standard OpenZeppelin-shaped ERC-20, and it cannot produce the revert being
defended against. The unconditional fix charges every user real gas and an
extra signature, on every deposit and every repay, for a branch that never
executes.

## Guidance

**Approve optimistically. Classify the failure. Fall back to zero-first only
when the failure has the exact shape the quirk produces.**

The fallback fires only when all three hold:

1. the approve failed,
2. the *existing* allowance was non-zero, and
3. the *target* amount was also non-zero.

Anything else — a rejected signature, an RPC error, a token reverting for its
own reasons — is a real error the user must see, not something to retry
(`web/hooks/useZeroFirstApprove.ts:113`):

```ts
// Only the non-zero-to-non-zero shape is worth retrying. Anything else — a
// rejected signature, an RPC failure, a token that reverts for its own
// reasons — is a real error the user needs to see.
const looksLikeNonZeroReset = failed.allowance > 0n && failed.amount > 0n;
if (!looksLikeNonZeroReset) {
  attempt.current = null;
  return;
}
```

Three details make it correct rather than merely plausible:

**Wait for the flow to settle before believing either outcome.** wagmi does not
clear the prior error synchronously, so for one tick after the clearing approve
is issued the *old* failure is still readable. A hook that reads it there
concludes its own retry failed and aborts. A `settled` ref gates the read until
the flow has actually moved (`useZeroFirstApprove.ts:69`).

**A confirmed approve must retire its attempt.** Otherwise the attempt lingers
for the life of the form, and any *later* approve failure — a rejected signature
on the next action, an unrelated revert — re-fires a zero-approve against an
allowance that was already correct, spending a transaction and moving chain
state for nothing. The E2E suite caught exactly this as an unexpected stream
surviving into a later scenario.

**Retry once, never loop.** A token that fails for a reason outside the
classifier surfaces its error instead of ping-ponging between zero and target.

## Why This Matters

The unconditional pattern is correct advice for a wallet or aggregator, which
must handle every token that exists. It is the wrong trade for an application
with a **known, controlled token set**, because the cost structure inverts: the
defensive transaction is paid always, by every user, while the failure it
prevents happens never.

What makes the optimistic version safe is that the failure is *observable and
recoverable*. The approve reverts, the app sees it, and the fallback still
lands — the user pays one wasted gas estimation, not a lost position. When a
failure has those properties, paying for it up front is insurance against an
event that has already been priced at zero.

The pattern also degrades correctly if the token set later widens. Adding a
USDT-class asset does not require finding this code: the classifier already
recognizes the shape, engages the fallback, and reports `usedFallback` so a
form can explain the second prompt. The cost of being wrong about the token set
is one failed transaction per re-approve on that token — not a broken flow.

## When to Apply

- Re-approving an allowance in an app whose token set is enumerable and reviewed
- Any defensive step whose cost is unconditional and whose failure mode is
  observable and recoverable — that combination is the signal to classify
  rather than pre-pay
- **Not** applicable to wallets, routers, or anything accepting arbitrary
  user-supplied token addresses; there, pay the unconditional cost

## Examples

**Rejected — unconditional, two transactions every time:**

```ts
await approve(token, spender, 0n);
await approve(token, spender, amount);
```

**Adopted — one transaction on the common path**, with the fallback armed:

```ts
const { submit, clearing, usedFallback } = useZeroFirstApprove(approveTx);
submit(token, spender, amount, currentAllowance);
// `clearing` lets the form explain why a second signature is being requested
// `usedFallback` records that this token genuinely needs zero-first
```

## Related

- [useWriteFlow: on-chain revert treated as confirmed](../logic-errors/usewriteflow-on-chain-revert-treated-as-confirmed.md) — the `hasFailed` signal this hook classifies against; `error` alone is null on a revert
- [Prefer battle-tested libraries over hand-rolled code](../best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md) — the counterweight, and why this case is an exception rather than a precedent
