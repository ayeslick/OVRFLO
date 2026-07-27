---
title: "Pattern #3's fix landed on a dead component; the live modal wrapper still had no error boundary"
category: runtime-errors
module: Web UI
date: 2026-07-27
problem_type: runtime_error
component: frontend_stimulus
severity: high
symptoms:
  - "web/components/MarketDetail.tsx renders FormBody directly, with no ModalErrorBoundary"
  - "web/components/ActionModal.tsx exports a fully-wired ActionModal wrapper (scrim, header, focus trap, ModalErrorBoundary) that is never imported anywhere in the app"
  - "The documented pattern #3 detection script (`rg -l ... web/components/*Modal*.tsx`) never flags MarketDetail.tsx because its filename doesn't match the *Modal* glob"
  - "A render-time throw inside any BorrowForm/SupplyForm/ConvertForm/AdjustRateForm/RepayForm branch (all reached only through MarketDetail in production) would unmount the whole dashboard behind the market row, exactly the failure mode pattern #3 was written to prevent"
root_cause: dead_code_divergence
resolution_type: code_fix
tags:
  - error-boundary
  - dead-code
  - react-19
  - modals
  - ovrflo
  - pattern-3
  - detection-script-gap
---

# Pattern #3's fix landed on a dead component; the live modal wrapper still had no error boundary

## Problem

`docs/solutions/runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md`
and critical pattern #3 established that every modal body performing data
fetches must be wrapped in `ModalErrorBoundary`, with the header and close
button outside the boundary. Commit `b1e2f56` ("fix(web): modal error
boundary per pattern #3...") applied that fix to `ActionModal.tsx`'s exported
`ActionModal` component.

The problem: `ActionModal` (the wrapper component, not the `FormBody`/
`ACTION_META` exports from the same file) was already dead code by the time
that fix landed. Two earlier commits — `c1b490c` ("build MarketDetail...")
and the restructure in `2f0184b`/`b481a05` — had replaced it in the live
render tree with `MarketDetail.tsx`, a near-duplicate wrapper (same scrim,
panel, focus trap, Escape handling, `FormBody` body) with a wider panel
(`market-detail-panel`, 640px vs 500px) and a slide-in animation
(`market-detail-view`). `MarketsApp.tsx` renders `MarketDetail`, never
`ActionModal`. The pattern #3 fix was applied to the file that looked most
like "the modal," but the actual render path had quietly diverged months
earlier.

This went undetected because the pattern's own documented detection script
scopes to a filename glob:

```bash
rg -l "useReadContract|useReadContracts|usePublicClient" web/components/*Modal*.tsx | \
  xargs -I{} sh -c 'rg -L "ModalErrorBoundary" "{}" && echo "VIOLATION: {}"'
```

`MarketDetail.tsx` does not contain the substring `Modal` in its filename, so
it never enters the glob and the check reports clean while the live modal
wrapper has no boundary at all.

## What Didn't Work

- **Trusting the existing detection script as ground truth.** It passed
  clean the whole time; the gap was found only by reading `MarketDetail.tsx`
  and `ActionModal.tsx` side by side and noticing `ActionModal` (the
  component) had zero importers anywhere in `web/` outside its own file and
  tests that import `FormBody` from the same module.
- **Assuming a component named after the concept ("ActionModal") is the one
  actually rendered.** The render tree is defined by what `MarketsApp.tsx`
  imports, not by which file looks most authoritative.

## Solution

Two changes, no visual or UX difference for users:

1. **Wrap `MarketDetail`'s body in `ModalErrorBoundary`**, mirroring the
   exact contract already established in `ActionModal`: a `reloadKey` state
   bumped by `onReset`, keyed onto `FormBody` so "Try again" remounts a
   healthy subtree instead of immediately re-throwing.

   ```tsx
   // web/components/MarketDetail.tsx
   const [reloadKey, setReloadKey] = useState(0);
   // ...
   <div className="market-detail-view">
     <ModalErrorBoundary onReset={() => setReloadKey((key) => key + 1)}>
       <FormBody key={reloadKey} action={action} market={market} user={user}
         symbols={symbols} accent={actionMeta.accent} onClose={onClose} />
     </ModalErrorBoundary>
   </div>
   ```

2. **Delete the now-fully-dead `ActionModal` wrapper component** from
   `ActionModal.tsx`, keeping `FormBody`, `ACTION_META`, `Accent`, and
   `accentClass` (all still consumed by `MarketDetail` and the test suite).
   `MarketDetail`'s wider panel and slide-in animation classes
   (`market-detail-panel`, `market-detail-view`) were deliberately **not**
   changed — merging the two components into one would have altered the
   live modal's width and dropped the animation, which is exactly the kind
   of behavior change a simplification pass must not introduce.

A regression test was added at
`web/tests/components/market-detail-error-boundary.test.tsx` that mocks
`FormBody` (via `vi.importActual` + override) to throw, renders `MarketDetail`
directly, and asserts the fallback (`data-testid="modal-error-boundary"`)
appears while the header title and a working close button remain mounted —
verifying the contract against the component that is actually in the render
tree, not against `ModalErrorBoundary` in isolation or against the dead
`ActionModal` wrapper.

## Why This Works

Same underlying mechanism as the original pattern #3 writeup: React error
boundaries only catch throws in their subtree, and `ModalErrorBoundary`'s
`getDerivedStateFromError` swaps just that subtree for a fallback on the next
render, leaving everything outside the boundary (header, close button,
dashboard behind the scrim) mounted and interactive. The fix simply moves
that boundary to sit around the body that users' browsers actually execute.

## Prevention

- **When a fix lands in a component, verify that component is reachable
  from the app entry point** (`app/page.tsx` → `MarketsApp` → ...) before
  trusting the fix is live. A quick check:

  ```bash
  rg -n "^import.*from \"\./ComponentName\"|<ComponentName\b" web/components/*.tsx web/app/**/*.tsx
  ```

  If the component's own definition is the only place its name appears
  (besides tests importing a *different* named export from the same file),
  it is dead.

- **Filename-glob-scoped detection scripts age badly across refactors.**
  Pattern #3's detection script has been updated to scope by *usage*
  (imports `ModalErrorBoundary` transitively reachable from `MarketsApp`)
  rather than by filename glob — see the updated script in critical pattern
  #3. Any future filename-scoped grep in this repo's patterns should be
  treated as a hint, not a proof, that the live path is covered.
- **Prefer testing the component that's actually mounted**, not just the
  primitive it depends on. `ModalErrorBoundary.test.tsx` proved the
  boundary class works; it did not — and could not — prove any particular
  modal wrapper actually used it. `market-detail-error-boundary.test.tsx`
  closes that gap for `MarketDetail` specifically.
- **When a restructure replaces a component in the render tree
  (`c1b490c`/`2f0184b`/`b481a05`), delete the superseded component in the
  same change**, or explicitly mark it as retained-for-tests. Keeping a
  fully-wired, unused sibling around is exactly how a later safety fix can
  land on the wrong twin.

## Related Issues

- Origin of the pattern: [`docs/solutions/runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md`](modal-render-error-crashes-dashboard-WebUI-20260421.md)
- Enforced by: [`docs/solutions/patterns/ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md) pattern #3 (detection script updated by this writeup)
- General guidance this reinforces: [`docs/solutions/best-practices/prefer-battle-tested-code-over-hand-rolled-equivalents.md`](../best-practices/prefer-battle-tested-code-over-hand-rolled-equivalents.md) — not a hand-rolled-vs-library issue, but the same "don't trust a comment or a name; verify against what's actually wired up" discipline
- Source files: `web/components/MarketDetail.tsx`, `web/components/ActionModal.tsx`, `web/components/ModalErrorBoundary.tsx`
- Test: `web/tests/components/market-detail-error-boundary.test.tsx`
