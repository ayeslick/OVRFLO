---
title: Token amount display rounded half-up and overstated balances
date: 2026-07-29
category: ui-bugs
module: web/lib/format.ts
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A balance of 0.999999999999999999 rendered as 1.0000"
  - "Acting on the displayed maximum reverts for insufficient balance"
  - "Three unit tests asserted the rounded-up output as correct"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [formatting, bigint, rounding, balances, display, revert]
---

# Token amount display rounded half-up and overstated balances

## Problem

`formatTokenAmount` rounded half-up, so a balance one wei short of a whole unit
displayed as the whole unit. A user reading `1.0000 wstETH` and acting on it
signs a transaction for more than they hold and eats the revert.

## Symptoms

- `999999999999999999n` (0.999999999999999999) rendered as `1.0000`
- Any "spend the displayed maximum" action against such a balance reverts
- Three unit tests asserted the rounded-up strings as the expected output —
  the defect had test coverage confirming it

## What Didn't Work

- **Treating this as cosmetic.** Display rounding looks like a presentation
  concern until the displayed number is the one the user types back in. Then it
  is an input to a transaction.
- **Trusting the green suite.** The tests passed because they encoded the bug.
  A suite agreeing with the code says nothing when both were written from the
  same wrong assumption.

## Solution

Floor by construction — integer-divide to the display precision and never
adjust upward (`web/lib/format.ts:26`):

```ts
// R21/M-14: floor, never round half-up. Rounding up overstates what the user
// holds — a 0.999 balance rendering as "1.00" invites them to spend a whole
// unit they do not have and eat the revert. Displaying slightly less than the
// truth is the safe direction for a balance.
const roundedTotal = value / divisor;
```

BigInt division truncates toward zero, so for non-negative balances the floor is
free — the fix is removing the half-up adjustment, not adding logic. The three
tests pinning the old strings were corrected to the floored values.

## Why This Works

Rounding direction is not a stylistic choice for a quantity the user can act
on; it is a **safety property**, and the two directions have unequal costs:

- **Rounding down** understates a balance by less than one display unit. The
  user leaves dust behind. Recoverable, and invisible in practice.
- **Rounding up** overstates it. The user attempts to spend value that does not
  exist, and the chain refuses — after a signature, a wallet prompt, and gas on
  a failed transaction. In a max-amount flow it happens on the most common
  action in the form.

So the rule generalizes past this function: **display quantities in the
direction that makes the user's next action safe.** For a balance or a
claimable amount, that is down. For an amount *owed* — a repayment quote, a fee
— it is up, for exactly the same reason.

## Prevention

- Any formatter whose output can be typed back into a transaction floors
  balances and ceilings obligations; state which one in a comment at the site.
- When a test is changed to accommodate a "fix," read it first — a test that
  already asserted the old behavior is evidence the behavior was deliberate
  *or* evidence the defect was never noticed. Distinguish the two before
  editing.
- Prefer integer arithmetic on the raw `bigint` over converting to `Number`,
  which reintroduces rounding at 2^53 and cannot be audited by reading it.

## Related Issues

- [Acceptance checkboxes are claims, not bookkeeping](../workflow-issues/acceptance-checkboxes-are-claims-not-bookkeeping.md) — this criterion was ticked while the defect was live; the tests are why it looked satisfied
- [Nullish default flips read semantics](./nullish-default-flips-read-semantics.md) — the neighbouring class of quiet display-layer correctness bug
- [Vitest frontend test quality antipatterns](../best-practices/vitest-frontend-test-quality-antipatterns.md) — on tests that confirm the implementation rather than the requirement
