export function parseUserError(error: unknown, fallback = "Transaction failed") {
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const message = raw.toLowerCase();

  if (message.includes("user rejected") || message.includes("user denied")) {
    return "You rejected the wallet request.";
  }
  if (message.includes("insufficient funds")) {
    return "Insufficient ETH to pay for gas.";
  }
  if (message.includes("slippage")) {
    return "Price moved beyond your slippage setting. Try a higher slippage or a smaller amount.";
  }
  if (message.includes("matured") || message.includes("expired")) {
    return "This market is no longer active.";
  }
  if (message.includes("market not approved")) {
    return "This market is not approved for deposits.";
  }
  if (message.includes("deposit limit exceeded")) {
    return "This market is at its deposit limit.";
  }
  if (message.includes("amount < min pt") || message.includes("amount is zero")) {
    return "Enter a valid amount above the minimum.";
  }
  if (message.includes("insufficient pt reserves")) {
    return "Not enough PT reserves remain to complete this claim.";
  }
  if (message.includes("pt mismatch") || message.includes("unknown pt")) {
    return "The selected PT market is invalid.";
  }
  if (message.includes("not matured")) {
    return "This market has not matured yet.";
  }
  if (message.includes("not owner") || message.includes("not admin")) {
    return "This wallet is not allowed to perform that action.";
  }

  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw || fallback;
}

export function parseStreamError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Failed to load streams");
  const message = raw.toLowerCase();

  if (message.includes("indexer") || message.includes("graphql") || message.includes("fetch")) {
    return "Unable to load stream data right now. The indexer may be temporarily unavailable.";
  }

  return "Unable to load your streams right now.";
}
