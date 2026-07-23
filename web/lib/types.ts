import type { Address } from "viem";

export type VaultInfo = {
  vault: Address;
  treasury: Address;
  underlying: Address;
  ovrfloToken: Address;
  lending: Address | null;
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

export type SaleListing = {
  id: bigint;
  seller: Address;
  market: Address;
  streamId: bigint;
  aprBps: number;
  feeBps: number;
  active: boolean;
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

export type LoanPool = {
  id: bigint;
  borrower: Address;
  aprBps: number;
  market: Address;
  totalContributed: bigint;
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

export type TxStep = "idle" | "approve" | "sign" | "confirming" | "confirmed" | "error";
