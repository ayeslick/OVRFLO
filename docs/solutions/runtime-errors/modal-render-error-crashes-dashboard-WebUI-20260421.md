---
title: "Modal render-time errors crash the entire dashboard and erase form state"
category: runtime-errors
module: Web UI
date: 2026-04-21
problem_type: runtime_error
component: frontend_stimulus
severity: high
symptoms:
  - "A thrown error inside NewOvrfloModal or ClaimModal body escapes to app/error.tsx"
  - "Entire dashboard unmounts on any render-time exception in a modal (e.g. RPC blip, wallet disconnect, malformed market data)"
  - "User loses selected market, deposit amount, slippage, and split preferences"
  - "No in-place recovery path; user must reconnect wallet and restart the flow"
  - "Transient useReadContracts / usePublicClient failures surface as full-page crashes"
root_cause: missing_workflow_step
resolution_type: code_fix
tags:
  - error-boundary
  - react-19
  - modals
  - resilience
  - wagmi
  - viem
  - ovrflo
  - r14
---

# Modal render-time errors crash the entire dashboard and erase form state

## Problem

Render-time throws inside `web/components/NewOvrfloModal.tsx` or
`web/components/ClaimModal.tsx` bodies (from `useReadContracts`,
`usePublicClient`, or malformed market data in a selector) bubbled up to
`app/error.tsx`, crashing the entire dashboard and wiping in-progress form
state. There was no in-place recovery surface — users had to reconnect their
wallet and re-enter deposit amount, slippage, and split from scratch.

## Symptoms

- Transient RPC failure inside an open `NewOvrfloModal` or `ClaimModal`
  unmounts the dashboard behind the modal.
- User's partially filled deposit form (amount, slippage, split) is lost on
  every error.
- Wallet must be reconnected after any render-time throw in a modal subtree.
- The app-level error page (`app/error.tsx`) takes over the whole viewport
  for what is really a localized failure.
- No way to retry the failing operation without a full page reload.
- Screen readers get no announcement of the failure because the app just
  re-navigates.

## What Didn't Work

- **Single top-level boundary in `app/layout.tsx`** — catches the throw but
  still unmounts everything under it, so dashboard state and modal form
  state are both destroyed. Defeats the point.
- **A hooks-based API (`useErrorBoundary`)** — React 19 still has no
  built-in hook for catching render errors; class components remain the
  supported primitive.
- **Adding `react-error-boundary`** — a third-party dependency for ~40 lines
  of code we can own outright. Rejected on dependency-surface grounds.
- **`try` / `catch` inside the modal body** — only catches synchronous code
  in event handlers; does nothing for render-time throws from descendant
  components.
- **Wrapping the entire modal (header included)** — a throw in the body
  could hide the close button, trapping the user in a broken modal with no
  escape.
- **`console.error` inside `componentDidCatch`** — violates the repo's
  `no-console` ESLint rule and the Unit 10 banned-patterns CI check. Left
  as a no-op until a proper telemetry sink lands.

## Solution

A small class-component error boundary scoped to the modal **body only**,
with an explicit `onReset` contract so the parent can bump a remount key or
refetch.

```tsx
"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { getErrorMessage } from "@/lib/errors";

interface Props {
  children: ReactNode;
  onReset?: () => void;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}
interface State { error: Error | null }

export class ModalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { void error; void info; }
  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };
  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div className="nb-status nb-status-error" role="alert" data-testid="modal-error-boundary">
          <p className="nb-kicker text-black/60">Modal error</p>
          <h3 className="mt-2 text-base font-bold uppercase tracking-wide text-black">Something went wrong</h3>
          <p className="mt-2 break-words text-sm leading-6 text-black/80">
            {getErrorMessage(error, "An unexpected error occurred.")}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="nb-button nb-button-dark mt-3 px-3 py-1.5 text-[11px] min-h-0 h-9"
            data-testid="modal-error-boundary-reset"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap only the body — header/close button stays outside so the user always
has a dismiss path:

```tsx
import { ModalErrorBoundary } from "./ModalErrorBoundary";

// ...header stays OUTSIDE the boundary so the close button always works...
<div className="nb-modal-body">
  <ModalErrorBoundary onReset={() => setReloadKey((k) => k + 1)}>
    {step === "underlying" ? (...) : (...)}
  </ModalErrorBoundary>
</div>
```

Same shape in both `NewOvrfloModal` and `ClaimModal`.

## Why This Works

**Root cause:** React propagates render-time throws up to the nearest error
boundary. With no component-level boundary, the nearest one was the
route-level `app/error.tsx`, which by design unmounts the entire route tree.

**Why the fix addresses it:**

- `getDerivedStateFromError` flips `state.error`, so the next render swaps
  the failing subtree for the fallback while leaving siblings (and
  everything above the boundary) untouched.
- The boundary sits **inside** the modal and **below** the header, so the
  dashboard behind the modal, the modal chrome, and the close button all
  stay mounted and interactive.
- `reset()` clears local error state **and** calls `onReset?.()`. Without
  `onReset` bumping a key or triggering a refetch, the boundary would
  remount the exact same failing subtree and immediately re-throw — the
  "Try again" button would appear to do nothing.
- `componentDidCatch` is a deliberate no-op; `void error; void info;`
  satisfies `no-unused-vars` without hitting the banned `console.*`
  patterns. It's a marked hook point for future telemetry.
- `role="alert"` on the fallback surfaces the failure to assistive tech,
  which a full route swap does not do cleanly.

## Prevention

- **Required pattern for new modals with data fetches:** wrap the modal
  *body* (not the header) in `ModalErrorBoundary`. Header must stay outside
  so the close button survives any body-level throw.
- **Always pair with `onReset`** that bumps a remount key or triggers a
  refetch. A boundary without a reset handler re-throws immediately on
  "Try again" and gives the user a dead button.
- **Unit test contract** — every consumer should cover these three cases
  (see `web/tests/components/ModalErrorBoundary.test.tsx`):

  ```tsx
  it("renders children when they don't throw", () => { /* ... */ });
  it("renders fallback + reset button on render-time throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // render <ModalErrorBoundary><Thrower/></ModalErrorBoundary>
    // expect getByTestId("modal-error-boundary") and reset button
    spy.mockRestore();
  });
  it("reset() recovers when the underlying condition is fixed", () => {
    // flip shouldThrow=false, click reset, assert children render
  });
  ```

  The `console.error` spy is required because React itself logs caught
  boundary errors; this is the one sanctioned use of touching `console` in
  tests.

- **Do not add `console.*` to `componentDidCatch`.** The `no-console` ESLint
  rule and the Unit 10 banned-patterns CI check will fail the build. When a
  telemetry sink lands, route through that — not through `console`.
- **Do not replace with a single top-level boundary.** An `app/layout.tsx`
  (or route-level `error.tsx`) boundary is complementary — a catch-all
  safety net, not a substitute. Only component-level boundaries preserve
  surrounding state.
- **Do not adopt `react-error-boundary` or equivalent 3P libs** for this
  use case. The ~50-line class is the sanctioned approach; revisit only if
  we need hook-style consumption in many places.
- **Keep the boundary scoped small.** One boundary per logical failure
  region (e.g., modal body, dashboard panel). Wrapping too much
  re-introduces the "lose everything on error" problem the boundary was
  meant to solve.

## Related Issues

- Plan reference: `docs/plans/2026-04-21-001-feat-web-production-readiness-plan.md` (R14, Phase 4 / Unit 9)
- Same surfaces, complementary bug class: [`docs/solutions/ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md`](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md)
- Error helpers consolidated in `web/lib/errors.ts` (`getErrorMessage`, `classifyUserError`) — context in [`docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md`](../developer-experience/post-refactor-dead-code-WebUI-20260421.md)
- Candidate for a new enforceable entry in [`docs/solutions/patterns/ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md) (pattern #3: "Modal bodies — and only modal bodies — are wrapped in a class-component error boundary")
- Source files: `web/components/ModalErrorBoundary.tsx`, `web/components/NewOvrfloModal.tsx`, `web/components/ClaimModal.tsx`
- Tests: `web/tests/components/ModalErrorBoundary.test.tsx` (T-WEB-ERRBOUND-1..3)
