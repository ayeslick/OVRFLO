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
};

export function createPonderClient(baseUrl = ponderUrl) {
  if (!baseUrl) return null;
  return createClient(baseUrl.replace(/\/$/, ""));
}

export async function fetchHeldStreamIds(user: Address, baseUrl = ponderUrl): Promise<HeldStream[]> {
  const client = createPonderClient(baseUrl);
  if (!client) return [];

  const normalized = user.toLowerCase();
  const result = await client.db.execute<StreamRow>(sql`
    select
      sablier_streams.stream_id,
      sablier_streams.recipient,
      sablier_streams.sender,
      asset.address as asset,
      sablier_streams.end_time,
      sablier_streams.canceled,
      sablier_streams.depleted
    from sablier_streams
    join asset on asset.id = sablier_streams.asset_id
    where lower(sablier_streams.recipient) = ${normalized}
      and sablier_streams.canceled = false
      and sablier_streams.depleted = false
    order by stream_id desc
  `);

  return result.map((row) => ({
    streamId: BigInt(row.stream_id),
    recipient: row.recipient,
    sender: row.sender,
    asset: row.asset,
    endTime: BigInt(row.end_time),
    canceled: row.canceled,
    depleted: row.depleted,
    deposited: 0n,
    withdrawn: 0n,
    withdrawable: 0n,
  }));
}
