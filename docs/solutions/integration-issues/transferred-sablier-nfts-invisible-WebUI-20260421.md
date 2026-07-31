---
module: web/lib/discovery/live-projection.ts, web/lib/discovery/stream-discovery.ts
date: 2026-04-21
problem_type: integration_issue
component: nextjs_react
symptoms:
  - "A Sablier stream NFT transferred to a new wallet never appeared in the new recipient's dashboard"
  - "Stream list stayed empty for the new owner even though the ERC-721 transfer succeeded on-chain"
  - "Scanning only OVRFLO Deposited logs returned the original recipient, so transferred streams were lost"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [sablier, erc721, stream-discovery, discovery, ownerOf, viem]
---

# Troubleshooting: Transferred Sablier NFTs invisible to the new recipient

## Problem

After a user transferred a Sablier V2 Lockup Linear NFT (the stream receipt minted by
OVRFLO on deposit) to a different wallet, that new wallet never saw the stream in its
dashboard. The original recipient also stopped seeing it (since they no longer owned
the NFT), so the stream effectively vanished from the UI even though it was active
on-chain.

## Environment

- Module: Web UI (`web/`)
- Stack: Next.js / React, viem, wagmi, TanStack Query
- Current discovery path: `web/lib/discovery/` (browser-side verified-log projection)
- Date originally solved: 2026-04-21 (Envio indexer interim); live on-chain cutover
  2026-07-31 replaced indexer transports

## Symptoms

- Dashboard stream list was empty for a wallet that had just received a Sablier NFT
  via `safeTransferFrom`.
- The original depositor wallet no longer saw the stream (correct), but the new owner
  did not see it either.
- Discovery keyed only on OVRFLO `Deposited(..., user, ..., streamId)` never considered
  token IDs whose mint recipient was someone else.

## What Didn't Work

**Attempted Solution 1: `Deposited`-only log scan.**

- Why it failed: `Deposited` records the *initial* recipient at mint time, not the
  current ERC-721 owner.

**Attempted Solution 2 (early): `ownerOf` for every historical deposit without a
recipient-side candidate set.**

- Why it failed alone: solved visibility for *old* owners checking their mint events,
  but a new recipient had no `Deposited` row pointing at them, so their token IDs were
  never considered.

**Attempted Solution 3 (interim): Sablier Envio GraphQL / later Ponder indexer.**

- Worked as a discovery hint while those services were live, but both indexer
  transports were removed in the 2026-07-31 on-chain liquidity discovery cutover.
  Treating indexer fields as ownership/eligibility authority was separately fixed —
  see the discovery trust-boundary learning.

## Solution

**Current approach (post-cutover):** browser-side verified-log projection builds a
*candidate* id set, then Sablier hydration is the ownership authority.

1. Scan OVRFLO `Deposited` origins (OVRFLO-issued streams only).
2. Scan Sablier `Transfer` logs where `to == connected account` (current-recipient
   candidates), bounded by the factory deployment / projection anchors.
3. Intersect origins with recipient transfers (`web/lib/discovery/stream-discovery.ts`).
4. Hydrate every surviving id from Sablier (`getStream`, `withdrawableAmountOf`,
   `ownerOf`) and **drop** any stream whose `ownerOf` is not the connected address
   (`web/lib/discovery/live-projection.ts`, `useHeldStreams`).

```typescript
// Candidate set — not ownership authority
const candidateIds = intersectOriginsWithRecipientTransfers({
  origins,
  recipientTransfers,
  account,
});

// Authority — drop mismatches
const owner = await client.readContract({
  address: SABLIER_LOCKUP,
  abi: sablierLockupAbi,
  functionName: "ownerOf",
  args: [tokenId],
});
```

The earlier "Transfer + Deposited" attempts failed because they lacked bounded
anchors, fail-closed projection outcomes, and mandatory `ownerOf` filtering. Those
are now first-class in the discovery stack.

## Why This Works

The Sablier NFT is the **authoritative record of ownership**. Log scans answer only
"which ids might be mine?" — the expensive discovery question. `ownerOf` (and the
rest of Sablier hydration) answers "do I own it / can I act on it?" Mint-time
protocol events remain useful for *origin filtering* (OVRFLO vs arbitrary Sablier
streams) but must never be the gate for current ownership.

## Prevention

- Whenever the UI asks "who owns this NFT right now?", use `ownerOf(tokenId)` (or
  equivalent hydration). Discovery projections and indexers may name candidates only.
- Treat `Transfer`-bearing NFTs as mutable ownership; upstream protocol mint events
  are not a source of truth for the current holder.
- When adding a discovery path, write the failure mode explicitly: "what happens if
  the NFT is transferred?" and "what happens if it is transferred twice?"
- Keep empty vs unavailable distinct for discovery failures
  (`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).

## Related Issues

- **Required reading:** [`../patterns/ovrflo-critical-patterns.md`](../patterns/ovrflo-critical-patterns.md)
  — pattern #1: current NFT ownership comes from the token, not derived mint events.
- [Stream discovery is a candidate set, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md)
- [Live discovery cutover must keep partial and stale reads fail-closed](./live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md)
- [post-refactor dead code](../developer-experience/post-refactor-dead-code-WebUI-20260421.md)
  — historical cleanup after the first scanner→indexer swing.
