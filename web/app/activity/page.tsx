"use client";

import { DefaultPageShell } from "@/components/kit/DefaultPageShell";

export default function ActivityPage() {
  return (
    <DefaultPageShell currentNav="activity">
      <section className="default-hub" data-ui="UI-WATCH-ACTIVITY">
        <header className="default-hub-welcome">
          <h2>Activity</h2>
        </header>
        <p>
          Confirmed protocol actions appear here after the bounded scan completes. This
          page does not apply the portfolio matrix.
        </p>
      </section>
    </DefaultPageShell>
  );
}