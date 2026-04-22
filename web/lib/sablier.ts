import type { PublicClient } from "viem";
import { CHAIN_ID, SABLIER_INDEXER_URL, SABLIER_LOCKUP } from "./config";

export interface SablierStream {
  id: string;
  tokenId: string;
  depositAmount: string;
  withdrawnAmount: string;
  startTime: string;
  endTime: string;
  canceled: boolean;
  depleted: boolean;
  intactAmount: string;
  asset: {
    symbol: string;
    decimals: number;
    address: string;
  };
  sender: string;
}

export class StreamScanError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "StreamScanError";
  }
}

// Upstream Sablier `LockupStream` entity. `category` filter pins us to
// LockupLinear so this query stays correct if Sablier's tranched/dynamic
// variants start landing in the same indexer. `depleted` is derived in
// TypeScript (not on the upstream schema) from `intactAmount === "0"`.
const GET_USER_STREAMS = `
query GetUserStreams($user: String!, $senders: [String!]!) {
  LockupStream(
    where: {
      recipient: { _eq: $user },
      sender: { _in: $senders },
      contract: { _eq: "${SABLIER_LOCKUP.toLowerCase()}" },
      chainId: { _eq: "${CHAIN_ID}" },
      category: { _eq: "LockupLinear" }
    },
    order_by: { tokenId: desc }
  ) {
    id
    tokenId
    depositAmount
    withdrawnAmount
    startTime
    endTime
    canceled
    intactAmount
    asset { symbol decimals address }
    sender
  }
}
`;

// Shape returned by the indexer — identical to `SablierStream` minus `depleted`,
// which is derived below.
type LockupStreamRow = Omit<SablierStream, "depleted">;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface StreamsQueryData {
  LockupStream: LockupStreamRow[];
}

export interface FetchUserStreamsArgs {
  // Accepted for call-site compatibility with the previous on-chain scanner;
  // the indexer-backed implementation does not use it.
  publicClient?: PublicClient;
  user: `0x${string}`;
  ovrfloAddresses: `0x${string}`[];
}

export async function fetchUserStreams({
  user,
  ovrfloAddresses,
}: FetchUserStreamsArgs): Promise<SablierStream[]> {
  if (!ovrfloAddresses.length) return [];

  let res: Response;
  try {
    res = await fetch(SABLIER_INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GET_USER_STREAMS,
        variables: {
          user: user.toLowerCase(),
          senders: ovrfloAddresses.map((a) => a.toLowerCase()),
        },
      }),
    });
  } catch (err) {
    throw new StreamScanError(
      err instanceof Error ? err.message : "Failed to reach Sablier indexer",
      err
    );
  }

  if (!res.ok) {
    throw new StreamScanError(
      `Sablier indexer returned HTTP ${res.status}`
    );
  }

  let json: GraphQLResponse<StreamsQueryData>;
  try {
    json = (await res.json()) as GraphQLResponse<StreamsQueryData>;
  } catch (err) {
    throw new StreamScanError(
      err instanceof Error ? err.message : "Sablier indexer returned invalid JSON",
      err
    );
  }

  if (json.errors && json.errors.length > 0) {
    const first = json.errors[0]?.message ?? "Sablier indexer returned GraphQL errors";
    throw new StreamScanError(first);
  }

  const rows = json.data?.LockupStream ?? [];
  return rows.map((row) => ({ ...row, depleted: row.intactAmount === "0" }));
}
