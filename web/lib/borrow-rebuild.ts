import type { Address } from "viem";

/**
 * Borrow rebuild must load real routed depth, authoritative eligibility,
 * and current router/request reads. Placeholders are invalid.
 */

export type BorrowRebuildRead =
  | { status: "ok" }
  | { status: "invalid"; reason: "placeholder-depth" | "placeholder-eligibility" | "placeholder-router" | "placeholder-request" };

export type BorrowRebuildInput = {
  routedDepth: bigint | null;
  eligibility: "eligible" | "ineligible" | "unread";
  /** Chain read of lending.router(). Zero is a real read. Null means unread. */
  router: Address | null;
  /** Explicit request-book read. `none` means no book. `unread` is a placeholder. */
  request: "none" | "unread" | { book: Address };
};

export function assertBorrowRebuildInputs(input: BorrowRebuildInput): BorrowRebuildRead {
  if (input.routedDepth === null) return { status: "invalid", reason: "placeholder-depth" };
  if (input.eligibility === "unread") return { status: "invalid", reason: "placeholder-eligibility" };
  if (input.router === null) return { status: "invalid", reason: "placeholder-router" };
  if (input.request === "unread") return { status: "invalid", reason: "placeholder-request" };
  return { status: "ok" };
}
