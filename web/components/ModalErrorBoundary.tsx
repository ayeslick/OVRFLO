"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

// Class-component error boundary for modal BODIES only (critical pattern #3).
// The modal header and close button stay outside so a body-level throw never
// traps the user. `reset` clears the error and calls onReset so the parent
// can bump a remount key — without that, "TRY AGAIN" would remount the same
// failing subtree and immediately re-throw.

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ModalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // Deliberate no-op hook point for future telemetry; console.* is banned.
  componentDidCatch(error: Error, info: ErrorInfo): void {
    void error;
    void info;
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="form-grid" role="alert" data-testid="modal-error-boundary">
          <div className="label mono status-negative">SOMETHING WENT WRONG — {this.state.error.message}</div>
          <button
            type="button"
            className="button mono"
            onClick={this.reset}
            data-testid="modal-error-boundary-reset"
          >
            TRY AGAIN
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
