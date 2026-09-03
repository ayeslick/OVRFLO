"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getDisclosure, subscribeDisclosure, toggleDisclosure } from "@/lib/disclosure";
import {
  getWatchSearchServerSnapshot,
  getWatchSearchSnapshot,
  stripLensFromLocation,
  subscribeWatchUrl,
} from "@/lib/watch-url";
import { NetworkChip } from "./NetworkChip";
import { RefetchNotice } from "./RefetchNotice";
import "./kit.css";

const NAV = [
  { href: "/", label: "Your OVRFLO", id: "home" },
  { href: "/create/", label: "Create", id: "create" },
] as const;

export type ShellNavId = (typeof NAV)[number]["id"];

function StripRetiredLens() {
  const search = useSyncExternalStore(
    subscribeWatchUrl,
    getWatchSearchSnapshot,
    getWatchSearchServerSnapshot,
  );
  useEffect(() => {
    stripLensFromLocation();
  }, [search]);
  return null;
}

function ModeControl({ location }: { location: "account" | "menu" }) {
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const label = disclosure === "advanced" ? "Return to Default" : "Go to Advanced";
  return (
    <button
      type="button"
      className="kit-mode"
      data-ui="UI-SHELL-MODE"
      data-location={location}
      data-disclosure={disclosure}
      onClick={toggleDisclosure}
    >
      {label}
    </button>
  );
}

export function Shell({
  children,
  currentNav,
  wallet,
  network,
  status,
}: {
  children?: ReactNode;
  currentNav?: ShellNavId | null;
  wallet?: ReactNode;
  network?: ReactNode;
  status?: ReactNode;
}) {
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);

  return (
    <div className="kit kit-shell" data-disclosure={disclosure} data-ui="UI-SHELL">
      <StripRetiredLens />
      <header className="kit-shell-header">
        <h1 className="kit-wordmark">
          <a href="/" data-ui="UI-SHELL-BRAND">
            OVRFLO
          </a>
        </h1>
        <nav className="kit-nav" aria-label="Default" data-ui="UI-SHELL-NAV">
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
        <details className="kit-menu" data-ui="UI-SHELL-MENU">
          <summary>Menu</summary>
          <nav className="kit-menu-nav" aria-label="Default">
            {NAV.map((item) => (
              <a
                key={item.id}
                href={item.href}
                data-current={currentNav === item.id ? "true" : "false"}
                aria-current={currentNav === item.id ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
            <ModeControl location="menu" />
          </nav>
        </details>
        <div className="kit-shell-account">
          <div className="kit-shell-network">{network ?? <NetworkChip />}</div>
          <div className="kit-shell-wallet">{wallet}</div>
          <ModeControl location="account" />
        </div>
      </header>
      <div className="kit-shell-body">
        {status}
        <RefetchNotice />
        {children}
      </div>
    </div>
  );
}