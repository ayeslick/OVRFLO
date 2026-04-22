import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  UserRejectedRequestError,
} from "viem";
import { StreamScanError } from "@/lib/sablier";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error"
): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (isRecord(error) && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function getReadContractsError(
  queryError: unknown,
  results: readonly unknown[] | undefined,
  fallback: string
): Error | undefined {
  if (queryError) {
    return new Error(getErrorMessage(queryError, fallback));
  }

  const failedResult = results?.find(
    (result) => isRecord(result) && result.status === "failure"
  );

  if (!failedResult || !isRecord(failedResult)) {
    return undefined;
  }

  return new Error(getErrorMessage(failedResult.error, fallback));
}

export function isFrontendConfigError(error: unknown): boolean {
  const message = getErrorMessage(error, "").toLowerCase();
  return (
    message.includes("next_public_") ||
    message.includes(".env") ||
    message.includes("mainnet only")
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Error taxonomy (R16, R17, R22).
//
// A single union used by StatusPanel, modal write paths (preflight), and the
// Sablier streams banner so each failure mode renders a purpose-built copy +
// recovery action. Every kind is deliberately coarse — we pattern-match on
// viem error classes + substring signals, we do NOT leak raw error bodies
// into the UI (R16: "no stack traces in production copy").

export type UserErrorKind =
  | "user-rejected"
  | "wrong-network"
  | "insufficient-balance"
  | "insufficient-gas"
  | "slippage"
  | "market-expired"
  | "deposit-limit"
  | "indexer-down"
  | "rpc-down"
  | "revert"
  | "unknown";

export interface ClassifiedError {
  kind: UserErrorKind;
  message: string;
  // When we successfully pulled a revert reason out of a viem error this is
  // set so callers can expose it to power users without leaking the full
  // stack. Regular UI just renders `message`.
  revertReason?: string;
}

// Lightweight substring signals used as fallbacks when the error isn't a
// recognizable viem/wagmi instance (e.g. connector errors that come back as
// plain Error instances with descriptive messages).
// Order matters — earlier entries win. Gas-related "insufficient funds ... for
// gas" must match *before* the generic balance signal; OVRFLO revert reasons
// must match before the generic balance signal so "deposit limit exceeded"
// doesn't get mis-bucketed.
const SIGNALS: ReadonlyArray<readonly [RegExp, UserErrorKind, string]> = [
  [/user rejected|user denied|user cancell?ed/i, "user-rejected", "You rejected the wallet request."],
  [/wrong network|chain mismatch|unsupported chain/i, "wrong-network", "Switch your wallet to the supported network."],
  [/insufficient funds.*gas|gas.*required exceeds|insufficient gas|out of gas/i, "insufficient-gas", "Not enough ETH to pay the gas fee."],
  [/ovrflo: slippage/i, "slippage", "Price moved beyond your slippage setting. Try a higher slippage or a smaller amount."],
  [/ovrflo: matured|market expired/i, "market-expired", "This market has already matured and is no longer accepting deposits."],
  [/ovrflo: deposit limit|deposit limit exceeded/i, "deposit-limit", "This market is at its deposit limit."],
  [/insufficient funds|insufficient.*balance|exceeds balance/i, "insufficient-balance", "Your balance is not enough to cover this action."],
  [/fetch failed|network request failed|failed to fetch/i, "rpc-down", "Network request failed. Check your internet connection and try again."],
];

function defaultMessageFor(kind: UserErrorKind, fallback: string): string {
  switch (kind) {
    case "user-rejected":
      return "You rejected the wallet request.";
    case "wrong-network":
      return "Switch your wallet to the supported network.";
    case "insufficient-balance":
      return "Your balance is not enough to cover this action.";
    case "insufficient-gas":
      return "Not enough ETH to pay the gas fee.";
    case "slippage":
      return "Price moved beyond your slippage setting. Try a higher slippage or a smaller amount.";
    case "market-expired":
      return "This market has already matured and is no longer accepting deposits.";
    case "deposit-limit":
      return "This market is at its deposit limit.";
    case "indexer-down":
      return "Sablier indexer is unavailable — streams may be out of date. Retrying…";
    case "rpc-down":
      return "Network connection to the blockchain RPC failed. Check your connection and retry.";
    case "revert":
      return "The transaction would revert on-chain.";
    case "unknown":
      return fallback;
  }
}

// viem's BaseError.walk lets us find a specific inner error class anywhere in
// the cause chain. Safer than `instanceof` alone because viem wraps errors
// (e.g. ContractFunctionExecutionError.cause is often a
// ContractFunctionRevertedError).
function walkFor<T extends BaseError>(
  err: BaseError,
  predicate: (e: unknown) => e is T
): T | undefined {
  const found = err.walk(predicate);
  return found as T | undefined;
}

export function classifyUserError(
  error: unknown,
  fallback = "Something went wrong"
): ClassifiedError {
  // Sablier indexer failures have their own typed error — checked first so a
  // GraphQL 500 doesn't fall through to the generic "unknown" bucket.
  if (error instanceof StreamScanError) {
    return {
      kind: "indexer-down",
      message: defaultMessageFor("indexer-down", fallback),
    };
  }

  if (error instanceof BaseError) {
    const rejected = walkFor(
      error,
      (e): e is UserRejectedRequestError => e instanceof UserRejectedRequestError
    );
    if (rejected) {
      return {
        kind: "user-rejected",
        message: defaultMessageFor("user-rejected", fallback),
      };
    }

    const chain = walkFor(
      error,
      (e): e is ChainMismatchError => e instanceof ChainMismatchError
    );
    if (chain) {
      return {
        kind: "wrong-network",
        message: defaultMessageFor("wrong-network", fallback),
      };
    }

    const reverted = walkFor(
      error,
      (e): e is ContractFunctionRevertedError =>
        e instanceof ContractFunctionRevertedError
    );
    if (reverted) {
      // Prefer the contract's own revert reason (e.g. "ovrflo: slippage")
      // so SIGNALS can map it to a specific kind. Fall back to the viem
      // shortMessage, then the generic "revert" copy.
      const reason =
        reverted.reason ??
        reverted.data?.errorName ??
        reverted.shortMessage ??
        "";
      for (const [needle, kind] of SIGNALS) {
        if (needle.test(reason)) {
          return {
            kind,
            message: defaultMessageFor(kind, fallback),
            revertReason: reason,
          };
        }
      }
      return {
        kind: "revert",
        message: reason || defaultMessageFor("revert", fallback),
        revertReason: reason || undefined,
      };
    }

    const http = walkFor(
      error,
      (e): e is HttpRequestError => e instanceof HttpRequestError
    );
    if (http) {
      return {
        kind: "rpc-down",
        message: defaultMessageFor("rpc-down", fallback),
      };
    }

    // Fall through to substring matching on viem's shortMessage for errors
    // that didn't have a recognizable inner class (custom errors encoded as
    // strings, RpcError subclasses without dedicated viem classes, etc.).
    const viemMessage = error.shortMessage || error.message;
    for (const [needle, kind] of SIGNALS) {
      if (needle.test(viemMessage)) {
        return { kind, message: defaultMessageFor(kind, fallback) };
      }
    }
    return {
      kind: "unknown",
      message: viemMessage || fallback,
    };
  }

  // Non-viem error: apply substring signals to the raw message, then fall
  // back to unknown.
  const raw = getErrorMessage(error, fallback);
  for (const [needle, kind] of SIGNALS) {
    if (needle.test(raw)) {
      return { kind, message: defaultMessageFor(kind, fallback) };
    }
  }
  return { kind: "unknown", message: raw };
}
