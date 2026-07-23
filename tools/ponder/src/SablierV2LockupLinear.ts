import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { shouldSkipMintTransfer } from "./logic";

const DEFAULT_ASSET_DECIMALS = 18n;
const DEFAULT_ASSET_SYMBOL = "OVRFLO";
const DEFAULT_ASSET_NAME = "OVRFLO token";
const CHAIN_ID = 1;

function streamKey(chainId: number, contract: string, tokenId: bigint) {
  return `${contract.toLowerCase()}-${chainId.toString()}-${tokenId.toString()}`;
}

function assetKey(chainId: number, asset: string) {
  return `asset-${chainId.toString()}-${asset.toLowerCase()}`;
}

ponder.on("SablierV2LockupLinear:CreateLockupLinearStream", async ({ event, context }) => {
  const contract = event.log.address.toLowerCase() as `0x${string}`;
  const chainId = CHAIN_ID;
  const assetId = assetKey(chainId, event.args.asset);

  await context.db
    .insert(schema.asset)
    .values({
      id: assetId,
      address: event.args.asset.toLowerCase() as `0x${string}`,
      chainId: BigInt(chainId),
      decimals: DEFAULT_ASSET_DECIMALS,
      name: DEFAULT_ASSET_NAME,
      symbol: DEFAULT_ASSET_SYMBOL,
    })
    .onConflictDoNothing();

  const depositAmount = event.args.amounts.deposit;

  await context.db
    .insert(schema.sablierStream)
    .values({
      id: streamKey(chainId, contract, event.args.streamId),
      chainId: BigInt(chainId),
      streamId: event.args.streamId,
      contract,
      category: "LockupLinear",
      recipient: event.args.recipient.toLowerCase() as `0x${string}`,
      sender: event.args.sender.toLowerCase() as `0x${string}`,
      funder: event.args.funder.toLowerCase() as `0x${string}`,
      assetId,
      cancelable: event.args.cancelable,
      canceled: false,
      depleted: false,
      depositAmount,
      intactAmount: depositAmount,
      withdrawnAmount: 0n,
      startTime: BigInt(event.args.range.start),
      endTime: BigInt(event.args.range.end),
      cliffTime: BigInt(event.args.range.cliff),
      transferable: event.args.transferable,
    })
    .onConflictDoUpdate({
      recipient: event.args.recipient.toLowerCase() as `0x${string}`,
      intactAmount: depositAmount,
      depleted: false,
    });
});

ponder.on("SablierV2LockupLinear:CancelLockupStream", async ({ event, context }) => {
  const id = streamKey(CHAIN_ID, event.log.address, event.args.streamId);
  await context.db
    .update(schema.sablierStream, { id })
    .set({
      canceled: true,
      cancelable: false,
      intactAmount: event.args.recipientAmount,
    });
});

ponder.on("SablierV2LockupLinear:WithdrawFromLockupStream", async ({ event, context }) => {
  const id = streamKey(CHAIN_ID, event.log.address, event.args.streamId);
  const stream = await context.db.find(schema.sablierStream, { id });
  if (!stream) return;

  const withdrawnAmount = stream.withdrawnAmount + event.args.amount;
  const intactAmount = stream.intactAmount > event.args.amount ? stream.intactAmount - event.args.amount : 0n;
  await context.db
    .update(schema.sablierStream, { id })
    .set({
      withdrawnAmount,
      intactAmount,
      depleted: intactAmount === 0n,
    });
});

ponder.on("SablierV2LockupLinear:RenounceLockupStream", async ({ event, context }) => {
  const id = streamKey(CHAIN_ID, event.log.address, event.args.streamId);
  await context.db
    .update(schema.sablierStream, { id })
    .set({ cancelable: false })
});

ponder.on("SablierV2LockupLinear:Transfer", async ({ event, context }) => {
  if (shouldSkipMintTransfer(event.args.from)) return;

  const id = streamKey(CHAIN_ID, event.log.address, event.args.tokenId);
  await context.db
    .update(schema.sablierStream, { id })
    .set({ recipient: event.args.to.toLowerCase() as `0x${string}` })
});
