---
title: Refs beat state for cross-effect race guards
date: 2026-07-29
category: design-patterns
module: web/hooks/useTxQueue.ts
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Two effects can run in the same commit and one must observe the other's decision
  - A guard must hold at the moment an action executes, not at the moment it rendered
  - A long-running queue can outlive the identity it was started for
tags: [react, useeffect, useref, stale-closure, race, signer-switch, tx-queue]
---

# Refs beat state for cross-effect race guards

## Context

`useTxQueue` runs a sequential transaction queue. Two effects guard it:

- a **pause effect** that sets `paused` when `user` changes mid-queue, and
- a **receipt-advance effect** that marks the confirmed row and dispatches the
  next transaction "unless paused."

When a receipt lands on the very render where `user` changed, both effects run
in the **same commit**. The advance effect's closure still holds the
pre-update `paused === false`, so it reads the guard as open and fires the next
transaction — at the **new** signer. Audit finding M-7 diagnosed this exactly.

## Guidance

**When a guard must hold at execution time, store it in a ref and read it
there. Do not add more state.**

```ts
// R42/M-7: the signer the queue was started for. […] A ref is read at
// execution time rather than captured in a closure, so it closes the window
// regardless of effect ordering.
const queueOwner = useRef<Address | undefined>(undefined);
```

The advance effect then asks the ref rather than the rendered value
(`web/hooks/useTxQueue.ts:158`):

```ts
// Read the owner from the ref, not from `paused`: on the commit where the
// signer changed, `paused` here is still the stale `false`.
const signerChanged = queueOwner.current !== undefined && queueOwner.current !== userRef.current;
if (paused || signerChanged || nextIndex >= rows.length) {
  setRunning(false);
  if (signerChanged) setPaused(true);
  return;
}
```

Note that `paused` is still checked. The ref does not replace the state — the
state drives rendering (the "WALLET CHANGED — RE-EVALUATING" notice), the ref
drives the decision. They answer different questions and both are needed.

**Ownership is claimed deliberately, at two points only.** `start` and `resume`
both set `queueOwner.current`, because resuming after a signer switch is an
explicit act by the user for the new signer — categorically different from
auto-advance drifting onto them.

## Why This Matters

Adding a second piece of state would not have fixed this, and understanding why
is the reusable part. React state is a **per-render snapshot**: every effect
scheduled by a commit sees the values from *that* commit. Two effects in one
commit therefore cannot observe each other's `setState` — the second one is
reading a value that is already obsolete but not yet replaced. Any guard built
from state inherits that semantics, so "add a `guardActive` flag" reproduces the
bug with more code.

A ref has the opposite semantics by design: one mutable cell, read at the moment
of access. That is precisely what a guard needs, and it makes the fix
**independent of effect ordering** — which matters because effect order is not
a contract you should be relying on.

On severity: this failed *closed* on-chain. Sablier rejects a withdrawal by a
non-recipient and `claimLoanPoolShare` reverts for a non-participant, so no
value could move. The real harm is a **wallet prompt the user never
initiated**, arriving right after they switched accounts — which is
indistinguishable, from the user's side, from a compromised page. Guard
failures that "cannot lose funds" can still destroy trust.

Cover the over-correction too: a test must assert the queue still advances
normally when the signer has **not** changed. A guard that never opens is as
broken as one that never closes, and much easier to ship.

## When to Apply

- Any `useEffect` whose decision depends on another effect's `setState` in the
  same commit
- Long-running client-side sequences (queues, wizards, polls) that can outlive
  the account, chain, or route they started under
- When the fix under consideration is "add another boolean" — check first
  whether the value needs to be *read at execution time*

## Examples

**The stale-closure guard:**

```ts
if (paused || nextIndex >= rows.length) { setRunning(false); return; }
execute(rows[nextIndex].tx);   // `paused` is still false on the switching commit
```

**The execution-time guard:**

```ts
const signerChanged = queueOwner.current !== undefined && queueOwner.current !== userRef.current;
if (paused || signerChanged || nextIndex >= rows.length) { … }
```

## Related

- [Freeze what you show, recompute what you submit](./freeze-what-you-show-recompute-what-you-submit.md) — the sibling race in the same queue, fixed in the same unit
- [useTxQueue: on-chain revert treated as confirmed](../logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md) — the other guard in this effect, and why `receipt.isSuccess` is not the outcome
- [Shared hook safety depends on render-tree position](../architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md) — the adjacent class of hook-ordering hazard
