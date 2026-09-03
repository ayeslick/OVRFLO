import type { Address } from "viem";
import { ZERO_ADDRESS } from "./config";

/**
 * CS4 may run deposit-plus-borrow without CS3 only when immediate borrow
 * is executable before the first wallet prompt. Without CS3, a no-liquidity
 * continuation blocks before deposit.
 */

export type LiquidityGate =
  | { status: "proceed"; reason: "immediate-borrow-executable" }
  | { status: "blocked"; reason: "no-liquidity-without-cs3" }
  | { status: "request"; reason: "cs3-continuation" };

export function depositPlusBorrowLiquidityGate(args: {
  borrowExecutable: boolean;
  cs3Available: boolean;
}): LiquidityGate {
  if (args.borrowExecutable) {
    return { status: "proceed", reason: "immediate-borrow-executable" };
  }
  if (args.cs3Available) {
    return { status: "request", reason: "cs3-continuation" };
  }
  return { status: "blocked", reason: "no-liquidity-without-cs3" };
}

/** CS3 is live when lending.router() is a nonzero book address. */
export function cs3ContinuationAvailable(router?: Address | null): boolean {
  return Boolean(router && router.toLowerCase() !== ZERO_ADDRESS.toLowerCase());
}
