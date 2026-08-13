"use client";

import type { ReactNode } from "react";
import "./kit.css";

export function DisclosureRow({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const panelId = `${id}-panel`;
  return (
    <div className="kit-disclosure-wrap" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="kit-disclosure"
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {label}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div id={panelId} className="kit-disclosure-body" role="region" aria-labelledby={id}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
