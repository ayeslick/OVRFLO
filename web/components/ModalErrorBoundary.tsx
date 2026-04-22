"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { getErrorMessage } from "@/lib/errors";

// ModalErrorBoundary (R14) — React 19 still requires a class-component
// boundary; there is no hooks API for catching render-time errors yet.
// Wrapping NewOvrfloModal and ClaimModal bodies means a blow-up inside a
// `useReadContracts`/`usePublicClient` call (RPC unreachable mid-render,
// wallet disconnecting while the modal is open, malformed market data)
// stays inside the modal — the dashboard behind it keeps its state, and
// the user can close the modal or hit "Try again" to remount the subtree.
//
// The boundary deliberately does not wrap the header/close button. The
// modal must always be dismissable. Only the data-fetch + write-path
// region lives under the boundary.
//
// The `onReset` prop is what drives remount: children read `resetKey`
// (incremented by `reset()`) on some hook or keyed subtree so that
// clicking "Try again" actually retries the failing work rather than
// re-rendering the same failing state.

interface Props {
  children: ReactNode;
  /**
   * Called when the user clicks "Try again". Parent should bump a key
   * or refetch so the next render doesn't immediately re-throw.
   */
  onReset?: () => void;
  /**
   * Optional override for the fallback UI. Receives the caught error and
   * a reset callback. Defaults to the built-in neobrutalist status card.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ModalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No-op on purpose: we do not ship a logger and we don't want a
    // console.* call tripping the Unit 10 banned-patterns CI check.
    // If telemetry lands later it plugs in here.
    void error;
    void info;
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div
          className="nb-status nb-status-error"
          role="alert"
          data-testid="modal-error-boundary"
        >
          <p className="nb-kicker text-black/60">Modal error</p>
          <h3 className="mt-2 text-base font-bold uppercase tracking-wide text-black">
            Something went wrong
          </h3>
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
