/**
 * CS4-U5 named product states. The eight-state data grammar in
 * surface-state.ts stays. These names sit on top of that grammar.
 */

export const NAMED_SURFACE_STATES = [
  "wallet-disconnected",
  "unsupported-network",
  "no-supported-underlying",
  "underlying-choice",
  "insufficient-balance",
  "amount-out-of-range",
  "no-valid-terms",
  "market-moved",
  "liquidity-unavailable",
  "stream-ineligible",
  "waiting-for-liquidity",
  "no-borrower-demand-yet",
  "quote-refreshing",
  "transaction-rejected",
  "transaction-reverted",
  "transaction-pending",
  "transaction-confirmed",
  "transaction-unknown",
  "network-read-failure",
  "caught-render-error",
  "incomplete-portfolio",
  "empty-portfolio",
  "completed-position",
  "pt-claim-available",
  "unwrap-available",
  "retired-router",
  "retired-market",
] as const;

export type NamedSurfaceStateId = (typeof NAMED_SURFACE_STATES)[number];

export type NamedSurfaceIcon =
  | "wallet"
  | "network"
  | "choice"
  | "balance"
  | "range"
  | "terms"
  | "moved"
  | "liquidity"
  | "stream"
  | "waiting"
  | "demand"
  | "refresh"
  | "rejected"
  | "reverted"
  | "pending"
  | "confirmed"
  | "unknown"
  | "failure"
  | "error"
  | "incomplete"
  | "empty"
  | "complete"
  | "claim"
  | "unwrap"
  | "retired";

export type NamedSurfaceAction = {
  id: string;
  label: string;
};

export type NamedSurfaceSpec = {
  id: NamedSurfaceStateId;
  label: string;
  icon: NamedSurfaceIcon;
  copy: string;
  primary: NamedSurfaceAction | null;
  secondary: NamedSurfaceAction | null;
  textActions: readonly NamedSurfaceAction[];
  suppressSubmit: boolean;
};

export type NamedSurfaceContext = {
  cs3Available?: boolean;
  disclosure?: "default" | "advanced";
  retiredRouter?: boolean;
  seriesMatured?: boolean;
  hasPersistedAttempt?: boolean;
  executeAllowed?: boolean;
};

export const KD7_RETIRED_MARKET_COPY =
  "This position continues on a replaced market. You can finish or withdraw it. New positions use the current market.";

export const WAITING_FOR_LIQUIDITY_COPY =
  "Vested ovrfloToken stays in the stream until you cancel this request or the loan closes. A request past series maturity cannot fill and must be cancelled.";

const REQUEST_BOOK_SPENDER_COPY = "The request-post authorization names the request book, not the lending market.";

export function namedSurfaceSpec(
  id: NamedSurfaceStateId,
  ctx: NamedSurfaceContext = {},
): NamedSurfaceSpec {
  switch (id) {
    case "wallet-disconnected":
      return spec(id, "Wallet disconnected", "wallet", "Connect a wallet to continue.", {
        primary: { id: "connect-wallet", label: "CONNECT WALLET" },
      });
    case "unsupported-network":
      return spec(id, "Unsupported network", "network", "Switch to the supported network.", {
        primary: { id: "switch-network", label: "SWITCH NETWORK" },
      });
    case "no-supported-underlying":
      return spec(id, "No supported underlying", "choice", "This column has no supported underlying.", {
        primary: null,
      });
    case "underlying-choice":
      return spec(id, "Choose underlying", "choice", "More than one supported underlying is available.", {
        primary: { id: "choose-underlying", label: "CHOOSE UNDERLYING" },
      });
    case "insufficient-balance":
      return spec(id, "Insufficient balance", "balance", "The wallet balance is below this amount.", {
        primary: { id: "change-amount", label: "CHANGE AMOUNT" },
      });
    case "amount-out-of-range":
      return spec(id, "Amount out of range", "range", "Enter an amount inside the allowed range.", {
        primary: { id: "change-amount", label: "CHANGE AMOUNT" },
      });
    case "no-valid-terms":
      return spec(id, "No valid terms", "terms", "No valid term remains for this selection.", {
        primary: { id: "change-term", label: "CHANGE TERM" },
      });
    case "market-moved":
      return spec(id, "Market moved", "moved", "The market moved. Review the new quote before submit.", {
        primary: { id: "review-again", label: "REVIEW AGAIN" },
        suppressSubmit: true,
      });
    case "liquidity-unavailable":
      return spec(
        id,
        "Liquidity unavailable",
        "liquidity",
        ctx.cs3Available
          ? "No fillable depth at this tick. Post a request to wait. This is not an immediate receipt."
          : "No fillable depth at this tick. A request book is not available.",
        {
          primary: ctx.cs3Available ? { id: "post-request", label: "POST REQUEST" } : null,
        },
      );
    case "stream-ineligible":
      return spec(id, "Stream ineligible", "stream", "This stream is not eligible collateral.", {
        primary: { id: "choose-stream", label: "CHOOSE STREAM" },
      });
    case "waiting-for-liquidity": {
      const execute =
        ctx.disclosure === "advanced" && ctx.executeAllowed === true && ctx.retiredRouter !== true;
      return spec(id, "Waiting for liquidity", "waiting", WAITING_FOR_LIQUIDITY_COPY, {
        primary: { id: "cancel-request", label: "CANCEL REQUEST" },
        secondary: execute ? { id: "execute-request", label: "EXECUTE" } : null,
        textActions: [{ id: "spender-note", label: REQUEST_BOOK_SPENDER_COPY }],
      });
    }
    case "no-borrower-demand-yet":
      return spec(
        id,
        "No borrower demand yet",
        "demand",
        "No borrower demand yet. Funds stay withdrawable. No promised return.",
        {
          primary: { id: "withdraw", label: "WITHDRAW UNFILLED" },
        },
      );
    case "quote-refreshing":
      return spec(id, "Quote refreshing", "refresh", "The quote is refreshing. Submit stays closed.", {
        primary: null,
        suppressSubmit: true,
      });
    case "transaction-rejected":
      return spec(id, "Transaction rejected", "rejected", "The wallet rejected the signature.", {
        primary: { id: "retry", label: "RETRY" },
      });
    case "transaction-reverted":
      return spec(id, "Transaction reverted", "reverted", "The transaction reverted. Review again.", {
        primary: { id: "review-again", label: "REVIEW AGAIN" },
      });
    case "transaction-pending":
      return spec(id, "Transaction pending", "pending", "The transaction is pending. Submit stays closed.", {
        primary: null,
        suppressSubmit: true,
      });
    case "transaction-confirmed":
      return spec(id, "Transaction confirmed", "confirmed", "The transaction confirmed.", {
        primary: { id: "view-detail", label: "VIEW DETAIL" },
      });
    case "transaction-unknown":
      return spec(
        id,
        "Transaction unknown",
        "unknown",
        "The transaction outcome is unknown. Do not submit again.",
        {
          primary: { id: "check-status", label: "CHECK STATUS" },
          suppressSubmit: true,
        },
      );
    case "network-read-failure":
      return spec(
        id,
        "Network read failure",
        "failure",
        "A read failed. This is not an empty portfolio and not a zero balance.",
        {
          primary: { id: "retry", label: "RETRY" },
        },
      );
    case "caught-render-error":
      return spec(
        id,
        "Caught render error",
        "error",
        ctx.hasPersistedAttempt
          ? "A render error interrupted this region. Resume the stored attempt."
          : "A render error interrupted this region.",
        {
          primary: ctx.hasPersistedAttempt
            ? { id: "resume-attempt", label: "RESUME ATTEMPT" }
            : { id: "resume-attempt", label: "TRY AGAIN" },
        },
      );
    case "incomplete-portfolio":
      return spec(
        id,
        "Incomplete portfolio",
        "incomplete",
        "Discovery is still running. This count is not a route.",
        {
          primary: { id: "wait", label: "WAIT" },
        },
      );
    case "empty-portfolio":
      return spec(id, "Empty portfolio", "empty", "No positions yet. Create a Self-Repaying Loan or a Fixed Return.", {
        primary: { id: "create", label: "CREATE" },
      });
    case "completed-position":
      return spec(id, "Completed position", "complete", "This position is complete. Detail stays reachable.", {
        primary: { id: "view-detail", label: "VIEW DETAIL" },
      });
    case "pt-claim-available":
      return spec(
        id,
        "PT claim available",
        "claim",
        "PT claim is available after series maturity with PT backing.",
        {
          primary: { id: "claim-pt", label: "CLAIM PT" },
        },
      );
    case "unwrap-available":
      return spec(
        id,
        "Unwrap available",
        "unwrap",
        "Unwrap is available when the reserve and wallet ovrfloToken balance permit.",
        {
          primary: { id: "unwrap", label: "UNWRAP" },
        },
      );
    case "retired-router":
      return spec(
        id,
        "Retired router",
        "retired",
        "This book is no longer the current router. Cancel still returns the stream.",
        {
          primary: { id: "cancel-request", label: "CANCEL REQUEST" },
        },
      );
    case "retired-market":
      return spec(id, "Retired market", "retired", KD7_RETIRED_MARKET_COPY, {
        primary: { id: "finish-position", label: "FINISH" },
        secondary: { id: "withdraw", label: "WITHDRAW" },
      });
  }
}

export function actionCardinality(row: NamedSurfaceSpec): {
  primaries: number;
  secondaries: number;
} {
  return {
    primaries: row.primary ? 1 : 0,
    secondaries: row.secondary ? 1 : 0,
  };
}

export function txNamedState(
  status: "rejected" | "reverted" | "pending" | "confirmed" | "unknown",
): NamedSurfaceStateId {
  if (status === "rejected") return "transaction-rejected";
  if (status === "reverted") return "transaction-reverted";
  if (status === "pending") return "transaction-pending";
  if (status === "confirmed") return "transaction-confirmed";
  return "transaction-unknown";
}

export function reviewLiveCopy(args: {
  drifted: boolean;
  checkpoint: "pending" | "confirmed" | "rejected" | "reverted" | "unknown" | string;
}): string | null {
  if (args.drifted) return namedSurfaceSpec("quote-refreshing").copy;
  if (
    args.checkpoint === "pending" ||
    args.checkpoint === "confirmed" ||
    args.checkpoint === "rejected" ||
    args.checkpoint === "reverted" ||
    args.checkpoint === "unknown"
  ) {
    return namedSurfaceSpec(txNamedState(args.checkpoint)).copy;
  }
  return null;
}

export function suppressStaleSubmit(args: {
  refreshing: boolean;
  pending: boolean;
  marketMoved: boolean;
}): boolean {
  return args.refreshing || args.pending || args.marketMoved;
}

function spec(
  id: NamedSurfaceStateId,
  label: string,
  icon: NamedSurfaceIcon,
  copy: string,
  extras: {
    primary?: NamedSurfaceAction | null;
    secondary?: NamedSurfaceAction | null;
    textActions?: readonly NamedSurfaceAction[];
    suppressSubmit?: boolean;
  },
): NamedSurfaceSpec {
  return {
    id,
    label,
    icon,
    copy,
    primary: extras.primary ?? null,
    secondary: extras.secondary ?? null,
    textActions: extras.textActions ?? [],
    suppressSubmit: extras.suppressSubmit === true,
  };
}
