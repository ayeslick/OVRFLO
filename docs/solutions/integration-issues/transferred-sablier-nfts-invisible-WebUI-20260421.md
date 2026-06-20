---
module: Web UI
date: 2026-04-21
problem_type: integration_issue
component: nextjs_react
symptoms:
  - "A Sablier stream NFT transferred to a new wallet never appeared in the new recipient's dashboard"
  - "StreamList stayed empty for the new owner even though the ERC-721 transfer succeeded on-chain"
  - "Scanning logs from the factory's deploy block returned the original recipient only, so transferred streams were lost"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [sablier, envio, graphql, erc721, stream-discovery, indexer, viem]
---

# Troubleshooting: Transferred Sablier NFTs invisible to the new recipient

## Problem

After a user transferred a Sablier V2 Lockup Linear NFT (the stream receipt minted by
OVRFLO on deposit) to a different wallet, that new wallet never saw the stream in its
dashboard. The original recipient also stopped seeing it (since they no longer owned it),
so the stream effectively vanished from the UI even though it was active on-chain.

## Environment

- Module: Web UI (`web/`)
- Stack: Next.js 15 / React 19, viem 2.x, wagmi 2.x, TanStack Query 5
- Affected files:
  - `web/lib/sablier.ts`
  - `web/hooks/useStreams.ts`
  - `web/components/StreamList.tsx`
  - `web/lib/contracts.ts` (Sablier Lockup ABI)
  - `web/lib/config.ts`
- Date solved: 2026-04-21
- External service: Sablier Envio indexer — `https://indexer.hyperindex.xyz/53b7e25/v1/graphql`

## Symptoms

- Dashboard "Your Streams" table was empty for a wallet that had just received a
  Sablier NFT via `safeTransferFrom`.
- The original depositor wallet no longer saw the stream (correct — they don't own
  the NFT anymore), but the new owner did not see it either.
- `eth_getLogs` traffic spiked on the configured RPC as the UI replayed OVRFLO
  `Deposited(user, market, ptAmount, toUser, toStream, streamId)` events from
  `NEXT_PUBLIC_FACTORY_FROM_BLOCK` forward.
- Error banner copy mentioned "on-chain stream scan" and `NEXT_PUBLIC_FACTORY_FROM_BLOCK`.

## What Didn't Work

**Attempted Solution 1: Keep the on-chain `Deposited` log scan and add a second pass over
`Transfer(from, to, tokenId)` to re-attribute ownership.**

- Why it failed: Still incorrect in the limit. Any intermediate wallet in the transfer
  chain had to be scanned, and we had no reliable bound on how far back to look on mainnet
  (Sablier Lockup has been live for years). It also multiplied the `eth_getLogs` cost and
  needed chunked block windows to avoid provider limits.

**Attempted Solution 2: Call `Sablier.ownerOf(tokenId)` for every deposit discovered from
the `Deposited` event and only show the stream if it belonged to the current user.**

- Why it failed: Solved visibility for *old* owners but not for *new* owners — the new
  recipient's wallet had no `Deposited` event pointing at it, so the scan never even
  considered their `tokenId`s. It also added one RPC round-trip per historical deposit.

**Attempted Solution 3: Walk forward from `ownerOf` by scanning ERC-721 `Transfer` logs
on the Sablier Lockup contract filtered on `to == user`.**

- Why it failed: Expensive (Sablier Lockup handles every stream transfer on the chain,
  not just OVRFLO's), and still required composing with the OVRFLO `Deposited` scan to
  tell "OVRFLO streams" apart from arbitrary Sablier streams.

## Solution

Revert the stream-discovery path to the Sablier Envio GraphQL indexer we had used
originally. Envio already tracks *current* `recipient` for every Sablier stream, so one
query answers "give me all Sablier streams whose current recipient is `user` and whose
sender is one of our OVRFLO instances" — which is exactly the UI's question.

**Key code (`web/lib/sablier.ts`):**

```typescript
import type { PublicClient } from "viem";
import { CHAIN_ID, SABLIER_ENVIO_URL, SABLIER_LOCKUP } from "./config";

const GET_USER_STREAMS = `
query GetUserStreams($user: String!, $senders: [String!]!) {
  Stream(
    where: {
      recipient: { _eq: $user },
      sender: { _in: $senders },
      contract: { _eq: "${SABLIER_LOCKUP.toLowerCase()}" },
      chainId: { _eq: "${CHAIN_ID}" }
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
    depleted
    intactAmount
    asset { symbol decimals address }
    sender
  }
}`;

export async function fetchUserStreams({
  user,
  ovrfloAddresses,
}: FetchUserStreamsArgs): Promise<SablierStream[]> {
  if (!ovrfloAddresses.length) return [];

  const res = await fetch(SABLIER_ENVIO_URL, {
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
  // ...error handling + return json.data?.Stream ?? [];
}
```

**Supporting changes:**

- `web/lib/config.ts` gained the constant:

  ```typescript
  export const SABLIER_ENVIO_URL =
    "https://indexer.hyperindex.xyz/53b7e25/v1/graphql" as const;
  ```

- `web/lib/contracts.ts` dropped the Sablier Lockup ABI entries that only served the
  on-chain scanner (`getStartTime`, `getEndTime`, etc.), keeping just what the UI
  still needs to execute: `withdrawMax`, `withdrawableAmountOf`, `calculateMinFeeWei`.
- `web/components/StreamList.tsx` updated its error copy from
  "on-chain stream scan … NEXT_PUBLIC_FACTORY_FROM_BLOCK" to "Could not load Sablier
  streams … Confirm the Sablier indexer is reachable".
- `web/hooks/useStreams.ts` stopped passing `publicClient` for stream discovery; the
  argument is still accepted by `fetchUserStreams` for call-site compatibility but
  is unused.
- `NEXT_PUBLIC_FACTORY_FROM_BLOCK` and its parser were later removed entirely
  (see the developer-experience writeup linked below).

## Why This Works

The Sablier NFT is the **authoritative record of ownership** — whoever currently holds
`tokenId` is entitled to withdraw the stream. The Envio indexer already maintains a
denormalized `Stream` table keyed by `recipient`, updated on every `Transfer`. Querying
`recipient == user` therefore sees post-transfer ownership for free, regardless of how
many hops the NFT went through.

The original on-chain log scan tried to reconstruct ownership from OVRFLO's `Deposited`
event, which records the *initial* recipient at mint time. That encoding is correct for
OVRFLO's purposes (it tells you who the protocol streamed value to) but is not a source
of truth for current ownership. Any approach built on top of that event has to carry
around a "is this still the owner?" side channel, which recreates the indexer we just
stopped using.

The indexer request is a single HTTP `POST`, so it also eliminates the `eth_getLogs`
fan-out that made cold page loads slow on free-tier RPCs.

## Prevention

- Whenever the UI asks "who owns this NFT right now?", prefer an indexer or
  `ownerOf(tokenId)` over derived state from contract events.
- Treat `Transfer(tokenId)`-bearing NFTs (ERC-721) as mutable ownership; the emitting
  contract's own events are the only canonical source of current ownership,
  *not* upstream protocol events.
- When adding a new discovery path, write the failure mode explicitly:
  "what happens if the NFT is transferred?" and "what happens if it is transferred
  twice?" belong in the design note before coding.
- Keep a single discovery surface. The on-chain scanner and the indexer path coexisted
  briefly while debugging — that kind of dual mode is a maintenance trap. If you
  reintroduce a scanner, delete it on the same PR that ships the replacement.
- Tests: `web/tests/lib/sablier.test.ts` mocks `global.fetch` and asserts the GraphQL
  payload shape (`recipient`, `sender`, `contract`, `chainId`). Keep that contract
  test in place so an accidental revert back to `eth_getLogs` fails immediately.

## Related Issues

- **Required reading:** [`../patterns/ovrflo-critical-patterns.md#1-erc-721-current-ownership-comes-from-the-token-not-from-derived-protocol-events-always-required`](../patterns/ovrflo-critical-patterns.md)
  — the rule extracted from this fix: current NFT ownership must come from the
  token contract (or an indexer that tracks its `Transfer` events), never from
  upstream protocol events like OVRFLO's `Deposited`.
- See also: [../developer-experience/post-refactor-dead-code-WebUI-20260421.md](../developer-experience/post-refactor-dead-code-WebUI-20260421.md)
  — the follow-up that removed the now-unused `FACTORY_FROM_BLOCK`, `parseFromBlock`,
  the `Deposited` ABI event, and Sablier log-scan ABI entries left behind by this fix.
- Related: [../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md)
  — shipped in the same session; covers the Dashboard/modal rewiring.
