---
title: Freeze what you show, recompute what you submit
date: 2026-07-29
category: design-patterns
module: web/components/ClaimAllModal.tsx, web/lib/claim-all.ts
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - A review step sits between planning a multi-step action and submitting it
  - The underlying state can change while a confirmation dialog is open
  - A batch or queue is assembled from live on-chain or indexed data
tags: [staleness, multi-step, transaction-queue, review-modal, claim-all, race]
---

# Freeze what you show, recompute what you submit

## Context

The claim-all modal builds a plan — which pool shares and which streams to
claim — and shows it for review before anything signs. That plan was frozen at
modal open by a `useState` initialiser, and `CONFIRM QUEUE` submitted the
frozen snapshot.

`RESUME` (the post-failure path) always re-planned from live props. The **first
confirm did not.** That asymmetry is what audit finding M-6 named: two paths
through the same modal disagreed about whether the plan was allowed to be
stale, and the more common path was the stale one.

Between opening the modal and confirming, a stream can be claimed elsewhere or
a pool share drawn down. The frozen plan then queues transactions that are
already spent.

## Guidance

**The snapshot the user reviews and the plan the app submits are two different
artifacts. Keep the first; recompute the second at the moment of submission.**

```tsx
onClick={() => {
  // R41/M-6: plan at submit, not at modal open. `reviewPlan` is the
  // snapshot the user is looking at, which is the right thing to *show*.
  const fresh = planClaimAll({ pools, streams });
  if (fresh.length === 0) {
    setNothingLeft(true);
    return;
  }
  setStarted(true);
  queue.start(fresh);
}}
```

Two rules follow from it:

- **Handle the empty recomputation explicitly.** If everything was claimed
  elsewhere, say so — `NOTHING LEFT TO CLAIM — THESE WERE CLAIMED ELSEWHERE
  WHILE THIS WAS OPEN` — rather than queueing zero transactions and reporting
  success. Silent success on an empty plan is indistinguishable from silent
  success on a completed one.
- **Make every path through the component agree.** The bug here was not that
  freezing is always wrong; it was that one path re-planned and another did
  not. When two paths disagree about freshness, the stale one is a defect
  regardless of which is more common.

## Why This Matters

Freezing the *display* is correct and should not be "fixed." A review list that
mutates under the user while they read it is worse than a slightly stale one —
they consented to a specific set of actions, and the list is the record of what
they were shown.

What must not be frozen is the **effect**. The user's consent is to the
*intent* ("claim everything I can"), not to a literal transaction list they
never saw as bytecode. Re-deriving that intent against current state is
therefore faithful to what they approved, not a departure from it.

The cost of getting this backwards is asymmetric. A stale plan does not silently
do nothing — it submits transactions against spent state, which means wallet
prompts the user must evaluate, gas on reverts, and a queue that fails partway
through for reasons the UI cannot explain. The stale-display failure, by
contrast, costs a re-read.

Recomputation also needs a guard against over-correction: a test must assert
that when nothing has moved, the recomputed plan submits **all** the reviewed
work. "Recompute" is one edit away from "drop items that are still valid."

## When to Apply

- Confirmation dialogs for multi-step or batch actions
- Any queue assembled from data that other actors can change
- Any component where a `useState(() => derive(props))` initialiser feeds
  something that eventually writes — that pattern silently pins derived state
  to first render

## Examples

**Rejected — plan pinned at first render, submitted verbatim:**

```tsx
const [plan] = useState<QueuedTx[]>(() => planClaimAll({ pools, streams }));
// …
<button onClick={() => queue.start(plan)}>CONFIRM QUEUE</button>
```

**Adopted — snapshot for display, fresh plan for effect:**

```tsx
const [reviewPlan] = useState<QueuedTx[]>(() => planClaimAll({ pools, streams })); // shown
const fresh = planClaimAll({ pools, streams });                                    // submitted
```

**The coverage that keeps it honest** — both directions, from
`web/tests/components/claim-all-modal.test.tsx`:

```ts
it("submits a plan recomputed at confirm time, not the one shown at open", …)
it("says so rather than queueing nothing when everything was claimed elsewhere", …)
it("submits the reviewed work unchanged when nothing moved", …)   // over-correction guard
```

## Related

- [Refs beat state for cross-effect race guards](./refs-beat-state-for-cross-effect-race-guards.md) — the sibling race in the same queue, fixed in the same unit
- [adjust-rate multicall shrink race](../logic-errors/adjust-rate-multicall-shrink-race.md) — the on-chain version of submitting against state that moved
- [Web markets outcome-first planners and tx queue](../architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md) — the planner/queue split this pattern operates inside
- [Deposit reviewed slippage bound must survive mid-flow block advances](../logic-errors/deposit-reviewed-slippage-bound-must-survive-mid-flow-blocks.md) — for single-tx rebuilds, the reviewed numeric bound is the frozen consent; recompute only when that bound is no longer protective
