"use client";

import "./first-run.css";
import "@/components/kit/kit.css";

const LAUNCHES = [
  { href: "/borrow", label: "BORROW" },
  { href: "/supply", label: "SUPPLY" },
  { href: "/assets", label: "ASSETS" },
] as const;

export function Chooser() {
  return (
    <section className="first-run-chooser" data-ui="UI-FIRST-RUN-CHOOSER" data-control="UI-FIRST-RUN-CHOOSER">
      <p className="first-run-chooser-lead">Borrow, Supply, and Assets.</p>
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
