import {
  fetchBorrowDemand,
  fetchHeldStreamIds,
} from "../ponder";

/**
 * Temporary parity-only access to the remaining legacy discovery surface.
 *
 * Live components and execution code must never import this module. Ticket 10
 * removed the gather branch with the on-chain `gatherLiquidity` view; ticket
 * 11 removes this Ponder branch and its process wiring.
 */
export const parityPonder = {
  fetchBorrowDemand,
  fetchHeldStreamIds,
};
