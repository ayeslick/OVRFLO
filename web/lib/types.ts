import type { Address } from "viem";

export type VaultInfo = {
  vault: Address;
  treasury: Address;
  underlying: Address;
  ovrfloToken: Address;
  /** OVRFLOReserve for this column; wrap/unwrap and the wrapped-underlying balance live here. */
  reserve: Address;
  lending: Address | null;
  /** Markets still mapped to this vault after replaceLending; empty when none. */
  retiredLendings: readonly Address[];
};

export type MarketInfo = VaultInfo & {
  market: Address;
  twapDurationFixed: number;
  feeBps: number;
  expiryCached: bigint;
  ptToken: Address;
  oracle: Address;
};

export type LiquidityPosition = {
  id: bigint;
  lender: Address;
  market: Address;
  aprBps: number;
  availableLiquidity: bigint;
};

export type Loan = {
  id: bigint;
  borrower: Address;
  streamId: bigint;
  obligation: bigint;
  drawn: bigint;
  repaid: bigint;
  closed: boolean;
};

export type HeldStream = {
  streamId: bigint;
  recipient: Address;
  sender: Address;
  asset: Address;
  endTime: bigint;
  canceled: boolean;
  depleted: boolean;
  deposited: bigint;
  withdrawn: bigint;
  withdrawable: bigint;
};

export type ActionType =
  | "supply"
  | "withdraw"
  | "claim_share"
  | "claim_position"
  | "deposit"
  | "claim_matured"
  | "wrap"
  | "unwrap"
  | "borrow"
  | "claim_stream"
  | "adjust_rate"
  | "repay"
  | "close";

export type ActiveAction = {
  type: ActionType;
  positionId?: bigint;
  loanId?: bigint;
  streamId?: bigint;
};
