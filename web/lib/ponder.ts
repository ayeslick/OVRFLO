import { createClient, sql } from "@ponder/client";
import type { Address } from "viem";
import { ponderUrl } from "./config";
import type { HeldStream } from "./types";

type StreamRow = {
  stream_id: string;
  recipient: Address;
  sender: Address;
  asset: Address;
  end_time: string;
  canceled: boolean;
  depleted: boolean;
  deposit_amount: string;
  withdrawn_amount: string;
};

const DEFAULT_STREAM_LIMIT = 100;

export function createPonderClient(baseUrl = ponderUrl) {
  if (!baseUrl) return null;
  return createClient(baseUrl.replace(/\/$/, ""));
}

export async function fetchHeldStreamIds(user: Address, baseUrl = ponderUrl, limit = DEFAULT_STREAM_LIMIT): Promise<HeldStream[]> {
  const client = createPonderClient(baseUrl);
  if (!client) return [];

  const normalized = user.toLowerCase() as Address;
  const result = await client.db.execute<StreamRow>(sql`
    select
      sablier_streams.stream_id,
      sablier_streams.recipient,
      sablier_streams.sender,
      asset.address as asset,
      sablier_streams.end_time,
      sablier_streams.canceled,
      sablier_streams.depleted,
      sablier_streams.deposit_amount,
      sablier_streams.withdrawn_amount
    from sablier_streams
    join asset on asset.id = sablier_streams.asset_id
    where sablier_streams.recipient = ${normalized}
      and sablier_streams.canceled = false
      and sablier_streams.depleted = false
    order by stream_id desc
    limit ${limit}
  `);

  return result.map((row) => ({
    streamId: BigInt(row.stream_id),
    recipient: row.recipient,
    sender: row.sender,
    asset: row.asset,
    endTime: BigInt(row.end_time),
    canceled: row.canceled,
    depleted: row.depleted,
    deposited: BigInt(row.deposit_amount),
    withdrawn: BigInt(row.withdrawn_amount),
    withdrawable: 0n,
  }));
}
