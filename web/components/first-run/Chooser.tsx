"use client";

import "./first-run.css";
import "@/components/kit/kit.css";

const LAUNCHES = [
  { href: "/borrow/", label: "Self-Repaying Loan" },
  { href: "/supply/", label: "Fixed Return" },
] as const;

export function Chooser() {
  return (
    <section className="first-run-chooser" data-ui="UI-FIRST-RUN-CHOOSER" data-control="UI-FIRST-RUN-CHOOSER">
      <p className="first-run-chooser-lead">Create a Self-Repaying Loan or a Fixed Return.</p>
      <nav className="first-run-chooser-nav" aria-label="First-run launches">
        {LAUNCHES.map((item) => (
          <a key={item.href} className="kit-action" href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    </section>
  );
}