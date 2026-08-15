# OVRFLO Stream Lens

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Repository: `OVRFLO` (main). This is OVRFLO periphery, not a stream-protocol contract, so it does not
go in the fork.
Unblocks: the complete-set consumers named in `2026-08-15-001`. Removes one Sweep Contract rule from
`2026-08-15-003`.

## Problem

Two unrelated defects share one cause: reading a stream costs four calls.

`web/hooks/useStreams.ts:175-193` hydrates every id with `ownerOf`, `getStream`,
`withdrawableAmountOf`, and `statusOf`. The fork's `tokensOfOwnerIn` returns `uint256[] memory
tokenIds` — **ids only**. It solved the reverse lookup, not the fan-out.

**Defect one — the complete-set consumers.** `web/lib/claim-all.ts:79` builds its claim queue from
the streams array, and `web/components/borrow/BorrowFlow.tsx:760` decides the `"empty"` stage from
it. Both need every stream the wallet holds. Once `2026-08-15-001` pages the list, both act on a
window: CLAIM ALL claims the loaded pages and reports success while leaving the rest, and a wallet
whose only eligible stream sits on a later page is told it has none and cannot borrow.

**Defect two — hydration can silently miss the pin.** `2026-08-15-003` requires the hydration batch
to carry the same block identity as the id pages. That is a rule an implementer must remember, and
the test-accountability lens showed the failure is invisible: pinning the pages and leaving
hydration on `readQuery` still stamps a coherent-looking `{blockNumber, blockHash}` pair.

## Product contract

- One call returns an owner's streams, hydrated. No fan-out, no multicall chunking.
- A per-stream read that reverts degrades that one row, never the whole call. This must not regress
  from today's `allowFailure: true`.
- The lens holds no state, has no admin, and owns nothing. It can be redeployed or replaced at will.
- It reads. It never writes, never holds tokens, and is never in a transaction path.
- The complete-set consumers get the complete set in one call, with no paging loop and no budget.

## Prior art

**Aave's `UiPoolDataProviderV3`** is the canonical precedent and the shape to follow. Verified from
source: it is stateless apart from two immutables, carries no admin and no access control, returns a
single composite struct array rather than parallel arrays, and uses `try/catch` for non-critical
sub-reads while letting core failures revert. It takes **no pagination parameter** — it returns
every reserve in one call.

Aave gets away with no pagination because a user's position count is bounded by the number of
reserves, roughly thirty. **OVRFLO's set is unbounded and transferable**, which is the harder case,
so this lens takes an optional range where Aave does not. That is the one deliberate divergence.

Morpho solves the same problem with a GraphQL API. That is an indexer and is excluded by
streams-plan R12.

## Interface

```solidity
struct StreamView {
    uint256 streamId;
    address owner;
    address sender;
    IERC20 asset;
    uint40 startTime;
    uint40 endTime;
    uint128 deposited;
    uint128 withdrawn;
    uint128 withdrawable;
    Lockup.Status status;
    bool isTransferable;
    bool ok;            // false when any per-stream read reverted; other fields are then unset
}

/// Complete set. One call, no paging. Serves claim-all and borrow eligibility.
function streamsOfOwner(ISablierV2Lockup lockup, address owner)
    external view returns (StreamView[] memory);

/// Windowed. Serves the wall's pager, and the degradation path for a wallet too large for one call.
function streamsOfOwnerIn(ISablierV2Lockup lockup, address owner, uint256 start, uint256 stop)
    external view returns (StreamView[] memory);
```

`streamsOfOwner` calls `balanceOf` then delegates to the windowed form with the full range, so there
is one implementation.

**The `ok` flag is the whole failure design.** Wrap each per-stream read group in `try/catch`. A
stream that reverts — burned between the id read and the hydration read, or any `notNull` guard —
comes back with `ok: false` and is dropped by the caller, exactly as
`web/hooks/useStreams.ts:296-304` drops a failed row today. Without this the lens reverts wholesale
and is a downgrade from `allowFailure: true`.

## Deployed, not deployless

Both work. The decision is about machinery, not capability.

A **deployless** call ships the lens bytecode in the frontend bundle and sends it as `eth_call` data
with no `to`. I verified this end to end: a constructor-return probe returned correctly against both
the seeded local Anvil 1.5.1 fork and the configured mainnet provider, and viem supports it
first-class — `call({ code, data })` at
`web/node_modules/viem/_esm/actions/public/call.js:49-56`, with `code` typed at
`_types/actions/public/call.d.ts:34`. Reports that this fails on Anvil are stale.

**Deploy it anyway.** The address pipeline already exists — `NEXT_PUBLIC_*` addresses, deployment
artifacts, `script/seed-local.sh`. Deployless would need new machinery this repo does not have:
embedding compiled bytecode into the web bundle plus a drift gate to keep it honest, which is
exactly the apparatus `artifacts/OVRFLOStream.json` and `check-ovrflo-stream-bytecode.mjs` provide
for the fork and which does not exist for main-repo contracts. Deployment also gets block-explorer
verification for free, which is cheap and this repo is public.

Recorded so it is not re-litigated: **deployless is a tested fallback, not a rejected idea.** If
deploy coordination ever becomes the bottleneck, it works today and the switch is a frontend change.

## What this deletes

- **The refusal threshold.** `MAX_ENUMERATION_IDS` exists because
  `web/hooks/useStreams.ts:156` fetches every id and hydrates all of them, so the only alternative
  to a truncated list is to refuse. With `2026-08-15-001` paging the display and this lens serving
  the complete-set consumers, nothing reads unboundedly and the threshold has no job. Delete it from
  all three books.
- **One `2026-08-15-003` Sweep Contract rule.** "The hydration batch carries the same pin as the id
  pages" stops being a rule an implementer must remember. One call is one block by construction, so
  the split-pin bug becomes impossible rather than guarded.

## Sizing the unbounded call

`streamsOfOwner` has no page size, so its cost is the node's `eth_call` gas cap, not a user's gas.
At roughly 10k gas per stream, a 5,000-stream wallet is about 50M gas — at Geth's default
`--rpc.gascap`. Measure the real per-stream cost during the build and record it here.

Beyond that ceiling the call fails rather than truncating, which is the correct direction. The
windowed form is the documented degradation: a complete-set consumer that hits the ceiling pages
through `streamsOfOwnerIn` instead of refusing the user. **Do not add a Solidity bound** — same
reasoning as `2026-08-15-002`: the cost lands on the caller's RPC, the failure is recoverable, and
an immutable constant chosen today cannot be changed.

## Files (when built)

- `src/OVRFLOStreamLens.sol` — new
- `test/OVRFLOStreamLens.t.sol` — new
- `script/` — a deploy script following the existing pattern
- `web/lib/config.ts`, `web/.env.example` — the lens address
- `web/wagmi.config.ts` / `web/lib/generated.ts` — the ABI
- `web/hooks/useStreams.ts` — hydration becomes one read
- `web/lib/claim-all.ts`, `web/components/borrow/BorrowFlow.tsx` — complete-set reads
- `script/seed-local.sh`, `deployments/local.json` — local deploy
- Maps, gated: `docs/maps/state/keys/chain-reads.md`, regenerated
  `docs/maps/state/functions/INDEX.md`

## Test accountability

- **A reverting stream degrades one row.** Burn a stream between the id read and hydration; assert
  the lens returns `ok: false` for it and correct data for its neighbours. This is the assertion
  that stops the lens regressing from `allowFailure: true`.
- **`streamsOfOwner` equals the concatenation of its windows.** Assert the unbounded form returns the
  same set as paging `streamsOfOwnerIn` across the whole range at one block.
- **The lens agrees with direct reads.** For one stream, assert every `StreamView` field equals what
  `ownerOf` / `getStream` / `withdrawableAmountOf` / `statusOf` return directly. Guards a field
  mis-wired in the struct, which no other test would catch.
- **Empty owner returns an empty array**, not a revert.
- **Gas ceiling for one stream**, recorded, so the unbounded-call sizing above stays honest. Measure
  with plain `forge test`; see the `--gas-report` note in `2026-08-15-002`.

## Out of scope

- Any change to the lockup. The lens reads what exists.
- The pager (`001`), the pin (`003`), the contract index (`002`).
- A lens for the lending books. `lenderPositionAt` and `borrowerLoanAt` are append-only and their
  hydration is not a four-call fan-out; revisit only if measurement says otherwise.
- Writing through the lens. It is a view contract and stays one.
