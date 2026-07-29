import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, UserRejectedRequestError } from "viem";

const customErrorCopy: Record<string, string> = {
  MarketNotApproved: "This market is not approved for OVRFLO.",
  WrongSender: "This stream was not created by this OVRFLO vault.",
  WrongAsset: "This stream pays the wrong asset.",
  WrongEndTime: "This stream does not end at the PT maturity.",
  SeriesMatured: "This market has already matured.",
  CliffPresent: "Streams with cliffs are not eligible.",
  CancelableStream: "Cancelable streams are not eligible.",
  RemainingZero: "This stream has nothing remaining.",
};

// StreamPricing eligibility custom errors. Exported for classifyBorrowError
// (lib/borrow.ts): a stream failing any of these can never be borrowed against.
export const eligibilityErrorNames = Object.keys(customErrorCopy);

const revertStringCopy: Record<string, string> = {
  "OVRFLOLending: factory zero": "Lending market is misconfigured.",
  "OVRFLOLending: core zero": "Lending market is misconfigured.",
  "OVRFLOLending: sablier zero": "Lending market is misconfigured.",
  "OVRFLOLending: unknown core": "This vault is not registered with the factory.",
  "OVRFLOLending: underlying zero": "Lending market is misconfigured.",
  "OVRFLOLending: token zero": "Lending market is misconfigured.",
  "OVRFLOLending: bad apr bounds": "APR bounds are invalid.",
  "OVRFLOLending: apr too high": "APR is above the protocol limit.",
  "OVRFLOLending: aprMin not step-aligned": "APR minimum is not step-aligned.",
  "OVRFLOLending: aprMax not step-aligned": "APR maximum is not step-aligned.",
  "OVRFLOLending: fee too high": "Fee is above the protocol limit.",
  "OVRFLOLending: treasury zero": "Treasury cannot be zero.",
  "OVRFLOLending: availableLiquidity zero": "Enter a liquidity amount greater than zero.",
  "OVRFLOLending: liquidity inactive": "Liquidity changed since your quote. Refreshing market depth.",
  "OVRFLOLending: not lender": "Only the lender can withdraw this liquidity.",
  "OVRFLOLending: insufficient availableLiquidity": "This liquidity position cannot fill the quote.",
  "OVRFLOLending: slippage": "Price moved outside your limit.",
  "OVRFLOLending: loan closed": "This loan is already settled.",
  "OVRFLOLending: loan not closable": "The stream has not vested enough to close this loan.",
  "OVRFLOLending: not borrower": "Only the borrower can repay this loan.",
  "OVRFLOLending: nothing outstanding": "This loan has nothing outstanding.",
  "OVRFLOLending: repay zero": "Enter a repayment greater than zero.",
  "OVRFLOLending: repay too much": "Repayment cannot exceed outstanding debt.",
  "OVRFLOLending: borrow zero": "Borrow amount must be greater than zero.",
  "OVRFLOLending: empty liquidity": "No liquidity positions were selected.",
  "OVRFLOLending: borrow above price": "Borrow amount exceeds the stream price.",
  "OVRFLOLending: claim zero": "Enter a claim amount greater than zero.",
  "OVRFLOLending: not loan pool lender": "This wallet did not contribute to this loan pool.",
  "OVRFLOLending: nothing claimable": "There is nothing claimable yet.",
  "OVRFLOLending: duplicate or unsorted ids": "Liquidity IDs must be strictly increasing.",
  "OVRFLOLending: market mismatch": "Selected liquidity belongs to another market.",
  "OVRFLOLending: apr mismatch": "Selected liquidity uses a different APR.",
  "OVRFLOLending: self-match": "You cannot borrow from your own liquidity.",
  "OVRFLOLending: apr out of bounds": "APR is outside the market bounds.",
  "OVRFLOLending: apr not whole": "APR must use a supported step.",
  "OVRFLOLending: stream below min": "This stream is too small to borrow against.",
  "OVRFLOLending: transfer mismatch": "Token transfer amount did not match the request.",
  "OVRFLOLending: unknown loan": "This loan does not exist.",
};

// Revert reasons that mean "liquidity moved between quoting and signing" —
// classifyBorrowError (lib/borrow.ts) recovers from these with an automatic
// re-quote instead of a terminal error. Kept here, next to revertStringCopy,
// so both stay in sync whenever a contract revert string changes.
export const STALE_LIQUIDITY_REASONS = [
  "OVRFLOLending: liquidity inactive",
  "OVRFLOLending: insufficient availableLiquidity",
  "OVRFLOLending: duplicate or unsorted ids",
  "OVRFLOLending: slippage",
] as const;

export function userFacingError(error: unknown) {
  const reverted = findRevert(error);
  const errorName = reverted?.data?.errorName;
  if (errorName && customErrorCopy[errorName]) return customErrorCopy[errorName];

  const message = error instanceof Error ? error.message : String(error);
  for (const [needle, copy] of Object.entries(revertStringCopy)) {
    if (message.includes(needle)) return copy;
  }
  return "The transaction failed. Check the entered values and try again.";
}

function findRevert(error: unknown): ContractFunctionRevertedError | undefined {
  if (error instanceof ContractFunctionRevertedError) return error;
  if (error instanceof BaseError) {
    return error.walk((cause) => cause instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | undefined;
  }
  return undefined;
}

/** The wallet handed the request back: the user declined, nothing was broadcast. */
export function isUserRejection(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof UserRejectedRequestError) return true;
  if (error instanceof BaseError && error.walk((cause) => cause instanceof UserRejectedRequestError)) return true;
  // EIP-1193 rejection code, for providers that do not surface a viem error.
  return (error as { code?: unknown }).code === 4001;
}

/**
 * Whether a failure was the *contract* refusing the call, as opposed to the user
 * declining it or the RPC never getting an answer.
 *
 * Callers that spend a second signature on a failure (R28's zero-first approve)
 * have to tell these apart: "the write flow failed" covers a rejected signature
 * and a dropped connection too, and reacting to those with another wallet prompt
 * buries the error the user actually needs to see.
 *
 * A revert reaches us two ways: mined and reverted on chain, or refused during
 * the wallet's simulate/estimate before broadcast — which is how a USDT-class
 * approve usually fails, so matching only the mined case would miss the common
 * path. `revertedOnChain` carries the first; the error chain carries the second.
 */
export function isRevertFailure(error: unknown, revertedOnChain = false): boolean {
  if (revertedOnChain) return true;
  if (!error || isUserRejection(error)) return false;
  if (findRevert(error)) return true;
  if (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError)) return true;
  // Bare `require(...)` reverts can reach us as a plain execution error with no
  // decodable data, so fall back to the message the node returned.
  const message = error instanceof Error ? error.message : String(error);
  return /revert/i.test(message);
}
