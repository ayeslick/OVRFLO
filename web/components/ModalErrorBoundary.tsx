"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { namedSurfaceSpec } from "@/lib/named-surface-state";
import { anyUnresolvedHash } from "@/lib/step-evidence";

// Class-component error boundary for modal BODIES only (critical pattern #3).
// The modal header and close button stay outside so a body-level throw never
// traps the user. `reset` clears the error and calls onReset so the parent
// can bump a remount key — without that, "TRY AGAIN" would remount the same
// failing subtree and immediately re-throw.
// Closing the modal is not cancelling the attempt.

interface Props {
  children: ReactNode;
  onReset?: () => void;
  region?: string;
  executionPhase?: string;
  control?: "UI-REVIEW-ERROR-BOUNDARY" | "UI-SHELL-REGION-BOUNDARY";
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
      const spec = namedSurfaceSpec("caught-render-error", {
        hasPersistedAttempt: anyUnresolvedHash(),
      });
      return (
        <div
          className="form-grid"
          role="alert"
          data-testid="modal-error-boundary"
          data-ui={this.props.control ?? "UI-REVIEW-ERROR-BOUNDARY"}
          data-region={this.props.region}
          data-execution-phase={this.props.executionPhase ?? "render"}
          data-named-state={spec.id}
        >
          <div className="label mono status-negative">
            {spec.label.toUpperCase()} — {this.state.error.message}
          </div>
          <p className="label mono">{spec.copy}</p>
          <button
            type="button"
            className="button mono"
            onClick={this.reset}
            data-testid="modal-error-boundary-reset"
          >
            {spec.primary?.label ?? "RESUME ATTEMPT"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Independent display region — shell chrome stays outside. */
export function RegionErrorBoundary({
  region,
  executionPhase = "render",
  children,
  onReset,
}: {
  region: string;
  executionPhase?: string;
  children: ReactNode;
  onReset?: () => void;
}) {
  return (
    <ModalErrorBoundary
      region={region}
      executionPhase={executionPhase}
      control="UI-SHELL-REGION-BOUNDARY"
      onReset={onReset}
    >
      {children}
    </ModalErrorBoundary>
  );
}
