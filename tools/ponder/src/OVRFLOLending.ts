import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { borrowEventKey, normalizeAddress } from "./logic";

const CHAIN_ID = 1;

ponder.on("OVRFLOLending:BorrowerLoanPoolCreated", async ({ event, context }) => {
  const lending = normalizeAddress(event.log.address) as `0x${string}`;
  await context.db
    .insert(schema.borrowEvent)
    .values({
      id: borrowEventKey(CHAIN_ID, lending, event.args.loanId),
      chainId: BigInt(CHAIN_ID),
      lending,
      market: normalizeAddress(event.args.market) as `0x${string}`,
      loanId: event.args.loanId,
      borrower: normalizeAddress(event.args.borrower) as `0x${string}`,
      aprBps: Number(event.args.aprBps),
      amount: event.args.totalContributed,
      blockTimestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
});
