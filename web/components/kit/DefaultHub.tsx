"use client";

import { useSyncExternalStore } from "react";
import { getDisclosure, subscribeDisclosure, toggleDisclosure } from "@/lib/disclosure";
import "./kit.css";

export function DefaultHub({
  welcome,
  help,
}: {
  welcome: string;
  help?: string;
}) {
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const modeLabel = disclosure === "advanced" ? "Return to Default" : "Go to Advanced";
  return (
    <section className="default-hub" data-ui="UI-SHELL-HUB">
      <header className="default-hub-welcome">
        <h2>{welcome}</h2>
      </header>
      <div className="default-hub-types">
        <a className="kit-card kit-type-card" href="/borrow/" data-type="loan">
          <span className="kit-medallion" data-identity="loan" aria-hidden="true" />
          <h3>Self-Repaying Loan</h3>
          <p>Borrow ovrfloToken against an eligible stream. The stream repays the loan on schedule.</p>
        </a>
        <a className="kit-card kit-type-card" href="/supply/" data-type="fixed">
          <span className="kit-medallion" data-identity="fixed" aria-hidden="true" />
          <h3>Fixed Return</h3>
          <p>Supply ovrfloToken at a chosen APR tick. Unmatched funds stay withdrawable.</p>
        </a>
      </div>
      <div className="default-hub-lower">
        <section className="default-hub-activity">
          <h3>Activity</h3>
          <p>Confirmed activity appears here after the scan completes.</p>
          <a href="/activity/">Open Activity</a>
        </section>
        <aside className="default-hub-help">
          <h3>Help</h3>
          <p>{help ?? "Need exact controls for this destination?"}</p>
          <button type="button" className="kit-mode" data-ui="UI-SHELL-MODE" data-location="help" onClick={toggleDisclosure}>
            {modeLabel}
          </button>
        </aside>
      </div>
    </section>
  );
}