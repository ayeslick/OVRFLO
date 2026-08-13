"use client";

import type { ReactNode } from "react";
import "./kit.css";

const NAV = [
  { href: "/borrow", label: "BORROW", id: "borrow" },
  { href: "/supply", label: "SUPPLY", id: "supply" },
  { href: "/assets", label: "ASSETS", id: "assets" },
  { href: "/risk", label: "RISK", id: "risk" },
] as const;

export type ShellNavId = (typeof NAV)[number]["id"];

export function Shell({
  children,
  currentNav,
  wallet,
  status,
  onHome,
}: {
  children?: ReactNode;
  currentNav?: ShellNavId | null;
  wallet?: ReactNode;
  status?: ReactNode;
  onHome?: () => void;
}) {
  return (
    <div className="kit kit-shell">
      <header className="kit-shell-header">
        <h1 className="kit-wordmark">
          <button type="button" onClick={onHome}>
            OVRFLO
          </button>
        </h1>
        <nav className="kit-nav" aria-label="Markets">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className="kit-nav-link"
              data-current={currentNav === item.id ? "true" : "false"}
              aria-current={currentNav === item.id ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="kit-shell-wallet">{wallet}</div>
      </header>
      <div className="kit-shell-body">
        {status}
        {children}
      </div>
    </div>
  );
}
