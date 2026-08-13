"use client";

import "./kit.css";

export type TokenUsdMode = "token" | "usd";

export function TokenUsdSwitch({
  mode,
  tokenLabel,
  usdAvailable,
  onChange,
}: {
  mode: TokenUsdMode;
  tokenLabel: string;
  usdAvailable: boolean;
  onChange: (mode: TokenUsdMode) => void;
}) {
  const disabled = !usdAvailable;
  return (
    <button
      type="button"
      className="kit-switch"
      disabled={disabled}
      data-state={disabled ? "disabled-unavailable" : mode}
      aria-label={disabled ? "USD UNAVAILABLE" : "Token or USD display"}
      onClick={() => {
        if (disabled) return;
        onChange(mode === "token" ? "usd" : "token");
      }}
    >
      <span data-on={mode === "token" && !disabled ? "true" : "false"}>{tokenLabel}</span>
      <span data-on={mode === "usd" && !disabled ? "true" : "false"}>
        {disabled ? "USD UNAVAILABLE" : "USD"}
      </span>
    </button>
  );
}
