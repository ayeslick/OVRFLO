---
title: A hook added below a guard early return crashes the form
date: 2026-07-29
category: runtime-errors
module: web/components/ActionModal.tsx, web/hooks/useClearOnConfirm.ts
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "React error: Rendered fewer hooks than expected. This may be caused by an accidental early return statement."
  - "The form crashes only after the wallet changes, never on the happy path"
  - "Four of five forms broke identically because the new hook was inserted the same way in each"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [react, rules-of-hooks, early-return, guard-clause, wallet-switch, useeffect]
---

# A hook added below a guard early return crashes the form

## Problem

Every form in `ActionModal.tsx` opens with a guard:

```tsx
if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;
```

`useClearOnConfirm` was added to clear a spent amount after confirmation
(requirement R7 / finding H-3). The natural place to put it is *next to the
state it clears* — which sits below that guard. React then renders a different
number of hooks depending on whether the wallet changed, and throws.

## Symptoms

- `Rendered fewer hooks than expected. This may be caused by an accidental early
  return statement.`
- Clean on every normal path; crashes only once `guard.walletChanged` flips
- Reproduced identically in four forms, because the same insertion mistake was
  made the same way in each

## What Didn't Work

- **Testing the happy path.** The guard is false for the entire lifetime of a
  normal session, so nothing exercises the short branch until a wallet switch.
- **Reading the diff for correctness.** The hook call is correct; its *position*
  is the defect, and position is exactly what a diff makes hardest to see when
  the surrounding lines are unchanged.

## Solution

Move every hook above every early return
(`web/components/ActionModal.tsx:422`):

```tsx
useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;
```

The hook itself absorbs the conditionality instead — it is always called, and
decides internally whether to act:

```ts
useEffect(() => {
  if (!isConfirmed) { handled.current = false; return; }
  if (handled.current) return;
  handled.current = true;
  clearRef.current();
}, [isConfirmed]);
```

## Why This Works

React identifies hooks by **call order**, not by name, so the count must be
identical on every render of a component. An early return truncates that
sequence, and any hook below it becomes conditional.

The reusable insight is not the rule — everyone knows the rule — but *why it
gets broken by careful people*. *The natural insertion point for a new hook is
usually below an existing guard*, because a hook is written next to the state or
handler it relates to, and guards sit above the body's working code. Following
good locality instinct walks you straight into it. That is why this happened in
four forms at once: it was not four mistakes, it was one instinct applied four
times.

Pushing the conditionality *into* the hook is the durable fix rather than a
workaround. `useClearOnConfirm` has to guard internally anyway — it must fire
once per confirmation rather than on every render while `isConfirmed` stays true,
or a user typing their next amount into the same open modal would have it wiped
out from under them. Once that logic lives inside, the call site has no reason
to be conditional at all.

## Prevention

- **Read hook placement relative to `return`, not relative to related code.**
  When adding a hook to an existing component, scan upward for the first early
  return and insert above it.
- When a component has guard clauses, keep all hooks in one block at the top so
  the boundary is visually obvious to the next person.
- Design hooks to be **unconditionally callable** — take the condition as an
  argument and no-op internally. A hook that must not be called in some states
  pushes the rules-of-hooks problem onto every call site.
- Cover the guard branch in tests. A guard that is false for a whole normal
  session is a branch nothing exercises by accident.

## Related Issues

- [Shared hook safety depends on render-tree position](../architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md) — the other way a hook's correctness depends on *where* it is called, not what it does
- [Refs beat state for cross-effect race guards](../design-patterns/refs-beat-state-for-cross-effect-race-guards.md) — the same "the hook must decide internally" principle, applied to timing
- [Modal render error crashes dashboard](./modal-render-error-crashes-dashboard-WebUI-20260421.md) — why an uncaught render error in a form is a whole-page failure
