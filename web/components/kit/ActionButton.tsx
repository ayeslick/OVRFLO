"use client";

import type { ReactNode } from "react";
import "./kit.css";
import "./action-link.css";

type Enabled = {
  disabled?: false;
  disabledReason?: undefined;
};

type Disabled = {
  disabled: true;
  disabledReason: string;
};

export type ActionButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  busy?: boolean;
  variant?: "default" | "primary";
} & (Enabled | Disabled);

export function ActionButton({
  children,
  onClick,
  busy = false,
  variant = "default",
  disabled,
  disabledReason,
}: ActionButtonProps) {
  const isDisabled = Boolean(disabled) || busy;
  return (
    <div className="kit-action-wrap">
      <button
        type="button"
        className="kit-action"
        data-variant={variant}
        data-busy={busy ? "true" : "false"}
        disabled={isDisabled}
        onClick={onClick}
      >
        {busy ? "SIGNING…" : children}
      </button>
      {disabled && disabledReason ? (
        <span className="kit-action-reason" data-disabled-reason={disabledReason}>
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
}
