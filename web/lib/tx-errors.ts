const REVERT_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["ovrflo: slippage", "Price moved beyond your slippage setting. Try a higher slippage or a smaller amount."],
  ["ovrflo: matured", "This market has already matured and is no longer accepting deposits."],
  ["ovrflo: not matured", "This market has not matured yet. Claims unlock at expiry."],
  ["ovrflo: amount < min pt", "Deposit is below the minimum PT amount."],
  ["ovrflo: amount is zero", "Enter an amount greater than zero."],
  ["ovrflo: deposit limit exceeded", "This market is at its deposit limit."],
  ["ovrflo: nothing to stream", "The market is priced at or above face value, so there is nothing to stream."],
  ["ovrflo: market not approved", "This market is not approved for deposits."],
  ["ovrflo: unknown pt", "The selected PT is not recognized by this OVRFLO."],
  ["ovrflo: deposit accounting", "Insufficient deposited PT remains to complete this claim."],
  ["ovrflo: no excess", "There are no excess PT tokens to sweep."],
  ["ovrflo: not admin", "This wallet is not the admin for this OVRFLO."],
  ["ovrflo: oracle zero", "The oracle address is invalid."],
  ["ovrflo: series already configured", "This market series is already configured."],
  ["ovrflo: pt already mapped", "This PT is already mapped to another market."],
  ["ovrflo: admin is zero address", "The admin address cannot be zero."],
  ["ovrflo: treasury is zero address", "The treasury address cannot be zero."],
  ["ovrflofactory: unknown ovrflo", "This OVRFLO is not registered with the factory."],
  ["ovrflofactory: nothing pending", "There is no pending deployment to execute."],
  ["ovrflofactory: oracle cardinality", "Oracle observation cardinality is too low; prepare the oracle first."],
  ["ovrflofactory: oracle not ready", "Oracle TWAP window has not accumulated enough observations yet."],
  ["ovrflofactory: underlying mismatch", "The market's underlying asset does not match this OVRFLO's configured underlying."],
  ["ovrflofactory: twap too long", "TWAP duration exceeds the allowed maximum."],
  ["ovrflofactory: twap too short", "TWAP duration is below the allowed minimum."],
  ["ovrflofactory: fee too high", "Fee exceeds the allowed maximum."],
  ["ovrflofactory: bad name", "Token name is empty or too long."],
  ["ovrflofactory: bad symbol", "Token symbol is empty or too long."],
  ["ovrflofactory: owner zero", "Owner address cannot be zero."],
  ["ovrflofactory: treasury zero", "Treasury address cannot be zero."],
  ["ovrflofactory: underlying zero", "Underlying address cannot be zero."],
];

export function parseUserError(error: unknown, fallback = "Transaction failed") {
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const message = raw.toLowerCase();

  if (message.includes("user rejected") || message.includes("user denied")) {
    return "You rejected the wallet request.";
  }
  if (message.includes("insufficient funds")) {
    return "Insufficient ETH to pay for gas.";
  }

  for (const [needle, text] of REVERT_MESSAGES) {
    if (message.includes(needle)) return text;
  }

  if (message.includes("ownable: caller is not the owner")) {
    return "This wallet is not the owner of this contract.";
  }

  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw || fallback;
}
