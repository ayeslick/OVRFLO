"use client";

import "./kit.css";

export function Amount({
  token,
  symbol,
  usd,
  usdAvailable,
  mode = "token",
}: {
  token: string;
  symbol: string;
  usd?: string;
  usdAvailable: boolean;
  mode?: "token" | "usd";
}) {
  const usdUnavailable = mode === "usd" && !usdAvailable;
  return (
    <span
      className="kit-amount"
      data-mode={mode}
      data-state={usdUnavailable ? "usd-unavailable" : usdAvailable ? "ready" : "token-only"}
    >
      <span className="kit-amount-token">
        {token} {symbol}
      </span>
      {mode === "usd" && usdAvailable && usd ? <span className="kit-amount-usd">{usd}</span> : null}
      {usdUnavailable ? <span className="kit-amount-usd">USD UNAVAILABLE</span> : null}
    </span>
  );
}
