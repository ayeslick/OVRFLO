"use client";

import { namedSurfaceSpec } from "@/lib/named-surface-state";
import { routeResetCopy } from "@/lib/resume-contract";
import { anyUnresolvedHash } from "@/lib/step-evidence";

export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const spec = namedSurfaceSpec("caught-render-error", {
    hasPersistedAttempt: anyUnresolvedHash(),
  });
  return (
    <main className="container" role="alert" data-region="route" data-execution-phase="render">
      <div className="form-grid">
        <h1 className="mono">{spec.label.toUpperCase()}</h1>
        <p className="label mono status-negative">{routeResetCopy()}</p>
        <p className="label mono">{spec.copy}</p>
        <button className="button mono" type="button" onClick={reset}>
          {spec.primary?.label ?? "RESUME ATTEMPT"}
        </button>
      </div>
    </main>
  );
}
