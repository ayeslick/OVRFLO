import { SABLIER_ENVIO_URL, SABLIER_LOCKUP, CHAIN_ID } from "./constants";

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

const GET_USER_STREAMS = `
query GetUserStreams($user: String!, $senders: [String!]!) {
  Stream(where: {
    recipient: {_eq: $user},
    sender: {_in: $senders},
    contract: {_eq: "${SABLIER_LOCKUP.toLowerCase()}"},
    chainId: {_eq: "${CHAIN_ID}"}
  }, order_by: {tokenId: desc}) {
    id
    tokenId
    depositAmount
    withdrawnAmount
    startTime
    endTime
    canceled
    depleted
    intactAmount
    asset { symbol decimals address }
    sender
  }
}
`;

export class SablierIndexerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphqlErrors?: Array<{ message: string }>
  ) {
    super(message);
    this.name = "SablierIndexerError";
  }
}

export async function fetchUserStreams(
  userAddress: string,
  ovrfloAddresses: string[]
): Promise<SablierStream[]> {
  if (!ovrfloAddresses.length) return [];

  const res = await fetch(SABLIER_ENVIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: GET_USER_STREAMS,
      variables: {
        user: userAddress.toLowerCase(),
        senders: ovrfloAddresses.map((a) => a.toLowerCase()),
      },
    }),
  });

  if (!res.ok) {
    throw new SablierIndexerError(
      `Sablier indexer returned ${res.status}`,
      res.status
    );
  }

  const json = await res.json();

  if (json?.errors?.length) {
    throw new SablierIndexerError(
      `Sablier GraphQL error: ${json.errors[0].message}`,
      undefined,
      json.errors
    );
  }

  return json?.data?.Stream ?? [];
}
