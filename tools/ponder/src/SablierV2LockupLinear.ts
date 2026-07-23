import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { applyWithdrawal, assetKey, normalizeAddress, shouldSkipMintTransfer, streamKey } from "./logic";

const DEFAULT_ASSET_DECIMALS = 18n;
const DEFAULT_ASSET_SYMBOL = "OVRFLO";
const DEFAULT_ASSET_NAME = "OVRFLO token";
const CHAIN_ID = 1;

ponder.on("SablierV2LockupLinear:CreateLockupLinearStream", async ({ event, context }) => {
  const contract = normalizeAddress(event.log.address) as `0x${string}`;
  const chainId = CHAIN_ID;
  const assetId = assetKey(chainId, event.args.asset);

  await context.db
    .insert(schema.asset)
    .values({
      id: assetId,
      address: normalizeAddress(event.args.asset) as `0x${string}`,
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
      recipient: normalizeAddress(event.args.recipient) as `0x${string}`,
      sender: normalizeAddress(event.args.sender) as `0x${string}`,
      funder: normalizeAddress(event.args.funder) as `0x${string}`,
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
      recipient: normalizeAddress(event.args.recipient) as `0x${string}`,
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

  await context.db
    .update(schema.sablierStream, { id })
    .set(
      applyWithdrawal({
        withdrawnAmount: stream.withdrawnAmount,
        intactAmount: stream.intactAmount,
        amount: event.args.amount,
      }),
    );
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
    .set({ recipient: normalizeAddress(event.args.to) as `0x${string}` })
});
