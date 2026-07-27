import { onchainTable } from "ponder";

export const asset = onchainTable("asset", (t) => ({
  id: t.text().primaryKey(),
  address: t.hex().notNull(),
  chainId: t.bigint().notNull(),
  decimals: t.bigint().notNull(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
}));

// One row per BorrowerLoanPoolCreated — the raw material for the trailing
// 30-day borrow-demand column (ticket 09).
export const borrowEvent = onchainTable("borrow_events", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.bigint().notNull(),
  lending: t.hex().notNull(),
  market: t.hex().notNull(),
  loanId: t.bigint().notNull(),
  borrower: t.hex().notNull(),
  aprBps: t.integer().notNull(),
  amount: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
}));

export const sablierStream = onchainTable("sablier_streams", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.bigint().notNull(),
  streamId: t.bigint().notNull(),
  contract: t.hex().notNull(),
  category: t.text().notNull(),
  recipient: t.hex().notNull(),
  sender: t.hex().notNull(),
  funder: t.hex().notNull(),
  assetId: t.text().notNull(),
  cancelable: t.boolean().notNull(),
  canceled: t.boolean().notNull(),
  depleted: t.boolean().notNull(),
  depositAmount: t.bigint().notNull(),
  intactAmount: t.bigint().notNull(),
  withdrawnAmount: t.bigint().notNull(),
  startTime: t.bigint().notNull(),
  endTime: t.bigint().notNull(),
  cliffTime: t.bigint().notNull(),
  transferable: t.boolean().notNull(),
}));
