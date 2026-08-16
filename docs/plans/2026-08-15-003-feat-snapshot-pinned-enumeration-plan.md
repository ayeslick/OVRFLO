# Snapshot-pinned enumeration

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Supersedes the dedupe requirement in `2026-08-15-001-feat-watch-enumeration-load-more-plan.md`.
Companion: `2026-08-15-002-feat-owner-only-stream-enumeration-plan.md` (contract).

**Build order: `001` and this plan are one change.** `001` introduces the paged hook; this plan makes
that paging correct. Building `001` alone ships a pager with the omission defect, and building this
plan alone has nothing to pin. `002` is independent of both and may land in any order. If you are
handed this plan without `001`, build them together rather than stopping — the earlier
"stop and report" wording in Sweep Contracts is superseded by this line.

The fork checkout that carries the contract work is `/Users/jay/OVRFLO-Streams-u4` on
`feat/u4-fork-deploy`, not the default `../OVRFLO-Streams`. That matters here because
`web/package.json`'s `pretest` runs `check-ovrflo-stream-bytecode.mjs`, which rebuilds the fork at
the stamped commit and hard-exits if the fork checkout lacks `node_modules`.

## The contract this plan reads

`OVRFLOStream` is **vanilla ERC-721** — the OpenZeppelin 4.9.2 `ERC721` the tree already had — plus
two OVRFLO mappings and one view. `ERC721Enumerable` and `IERC721Enumerable` are removed entirely,
along with `_allTokens`, `_allTokensIndex`, `totalSupply`, `tokenByIndex`, and
`tokenOfOwnerByIndex`. Plan `002` makes that change.

```
ERC721 (unmodified)
    _owners           tokenId → owner        canonical ownership
    _balances         owner   → count        canonical count

OVRFLO owner index (additions)
    _ownedTokens      owner + index → tokenId    discovery
    _ownedTokenIndex  tokenId → index            O(1) removal

External enumeration surface
    tokensOfOwnerIn(owner, start, stop)          and nothing else
```

This plan is written against that target. It is also correct against the tree as it stands today,
because the owner-side algorithm is the same swap-and-pop either way — the fork vendors it rather
than inheriting it. The two plans therefore ship in any order.

## Problem

Owner index positions are not stable. Removal moves the owner's **last** token into the vacated
slot. A stream leaves an owner on transfer and on burn, and OVRFLO streams burn on depletion, so
this happens in normal use.

Paging that index across separate RPC calls therefore has two failure modes, not one.

**Duplication.** An id moves forward into a page already fetched, and appears twice.

**Omission — the one that matters.** Alice holds 1,000 streams. Page 1 reads indices 0–499. The
token at index 100 then leaves. Swap-and-pop moves the token from index 999 into slot 100 and pops
999. Page 2 reads 500–998. The moved token now sits at index 100, which page 1 already passed with
different contents. **Neither page returns it.**

Deduplication cannot repair an omission. Nor can `ownerOf` verification: the client never received
the id, so it has nothing to check. A wallet silently loses a stream from its wall, and every
per-row action on that stream becomes unreachable.

## Product contract

- All pages of one enumeration describe one chain state. A transfer mid-enumeration cannot add,
  drop, or duplicate a row.
- The snapshot's identity is recorded on the result, and the identity is `{ number, hash }`, not a
  number alone. A reorg that replaces block N must be distinguishable from block N.
- Refresh advances the snapshot. It does not re-read the old one.
- A duplicate id across pages is an invariant violation, not something to silently merge. Fail closed.
- Discovery being seconds old must never let an invalid transaction be signed. Writes read current
  state and simulate against latest.

## The model

```
owner index    = discovery
ownerOf        = ownership authority
block identity = enumeration consistency
simulation     = transaction authority
```

Keep that comment in the hook. It is the whole design in four lines.

The index is a hint about which ids to look at. `ownerOf` decides whether the wallet holds them. The
pinned block makes the hint internally consistent across calls. Simulation against latest state
decides whether a transaction is valid, regardless of how old the display is.

## Approach

### Pin by block hash — simplified 2026-08-15 for the protocol client

Verified 2026-08-15 against the configured mainnet provider: `eth_call` with an EIP-1898
`{"blockHash": …}` state parameter returns state correctly.

**Superseding note (2026-08-15).** The original rule below — set `blockHash`,
`requireCanonical: true`, *and* `blockNumber` together — was verified engineering against the
wagmi hook path, whose fallback strips `blockHash` (still documented below because the evidence
matters). That machinery is gone: `008` moves the pinned read into the protocol client
(`loadStreamPage` / `loadCompleteStreams`), which formats its own EIP-1898 block selector. Per the
spec the selector is *either* `{blockHash, requireCanonical}` *or* `{blockNumber}`, never both. The
rule becomes:

- **Primary:** send `{blockHash, requireCanonical: true}`. Reorged pin → error → discard and
  re-pin.
- **Compatibility fallback (per provider, decided by the `008` capability probe):** send
  `{blockNumber: N}`, and before accepting the completed snapshot verify block `N` still has hash
  `H`. Coherence plus verification, not selector maximalism.
- **Provider affinity:** one snapshot, one provider. Capture `{N, H}` from provider P and run every
  page of that snapshot through P. If P fails, discard the whole snapshot and restart from page one
  on the next provider. Request-level transport fallback must never put page 1 on provider A and
  page 2 on provider B — two providers can disagree on heads and on EIP-1898 handling, producing a
  snapshot that is "pinned" but not to one worldview.
- **Unchanged:** assert the block identity on every returned outcome; never treat the pin as
  structurally guaranteed.

**The original three-together rule, kept for the record.** Each setting closed a hole the other two
left open. Setting only `blockHash` — the obvious reading — was unsafe in two separate ways, both
verified in the installed stack.

**`requireCanonical` is not implied.** viem emits the flag only when it is set:
`if (blockHash) return requireCanonical ? { blockHash, requireCanonical } : { blockHash };`
(`web/node_modules/viem/_esm/utils/block/formatBlockParameter.js`). Under EIP-1898 a bare
`blockHash` lets a node that still holds a reorged-out block serve its state without error. Hash
pinning alone therefore guarantees "never the replacement block", **not** "errors on reorg". Without
the flag the enumeration can read a consistent orphaned branch indefinitely.

**`blockHash` is dropped on wagmi's fallback path.** `@wagmi/core`'s `readContracts` destructures
`const { allowFailure = true, blockNumber, blockTag, ...rest } = parameters`
(`web/node_modules/@wagmi/core/dist/esm/actions/readContracts.js:5`). The happy path forwards
`...rest`, so `blockHash` survives. The catch path re-issues per-contract reads as
`readContract(config, { ...contract, blockNumber, blockTag })` (`:36`) — `blockHash` is gone.
Those reads then run at `latest` and **succeed**. The enumeration returns unpinned data with no
error and no failure entry, and the duplicate assertion cannot catch it because the ids are
self-consistent, just from the wrong block.

`blockNumber` is named explicitly on both paths, so setting it alongside `blockHash` keeps the
fallback pinned to the right height even when the hash is stripped.

Do not describe the pin as structurally guaranteed. **Assert the block identity on the returned
outcome** rather than assuming the request carried it.

Verified anchors:

- viem's `multicall` destructures `blockHash`, `blockNumber`, and `requireCanonical`, and forwards
  all three (`web/node_modules/viem/_esm/actions/public/multicall.js:54`, `:133-151`).
- `blockHash` is top-level on `InfiniteReadContractsOptions` by derivation — it includes
  `StrictOmit<ReadContractsParameters, 'contracts'>`, and `ReadContractsParameters` is viem's
  `MulticallParameters` (`web/node_modules/@wagmi/core/dist/types/query/infiniteReadContracts.d.ts:6-9`).
  `wagmi`'s `useInfiniteReadContracts` re-exports that shape unchanged
  (`web/node_modules/wagmi/dist/types/hooks/useInfiniteReadContracts.d.ts:8`), so a caller can pass
  it through the React hook.

`blockHash` is a **top-level** option on that type, not per-page. *(Superseded 2026-08-15 with the
rest of the wagmi-path rules: the read now goes through the protocol client, so the
one-pin-per-enumeration property is owned there instead — `loadStreamPage` takes the pin as a
required argument supplied once per enumeration, and the TanStack query key carries `{blockHash}`
so two pages cannot be pinned differently without producing two distinct queries. The invariant is
unchanged; its enforcement point moved.)*

Pin by hash rather than number. A block that is reorged out makes the call error instead of silently
serving the replacement block's state, which is the fail-closed behavior this codebase already uses.

**Fallback risk — closed 2026-08-15 by provider affinity (see the superseding note above).**
Snapshots are provider-affine: the whole snapshot runs on one provider, and a provider failure
discards the snapshot rather than failing over mid-enumeration. The per-provider pin mode
(hash+`requireCanonical`, or number+verify-hash) is chosen by `008`'s capability probe. The
original finding, kept for the record: `web/lib/wagmi.ts:32` builds an ordered transport over
`rpcUrls`, so reads can land on a fallback provider. EIP-1898 support is provider-dependent. Either
confirm every configured fallback serves a block-hash state parameter, or pin by `blockNumber` and
verify the recorded `blockHash` still matches after the last page — which gives the same guarantee
on any provider at the cost of one extra read.

### No archive provider is required

The pin is always a recent block. Pages are fetched seconds apart, well inside the recent-state
window any full node serves. Archive access is only needed for genuinely old blocks. Record this in
the plan so it is not raised as a blocker.

### The snapshot clock replaces `refetchInterval`

`readQuery` sets `refetchInterval: READ_INTERVAL_MS` (`web/lib/query-keys.ts:10`). On a query pinned
to one block that is meaningless: it re-asks what state was at N and gets the same answer forever.

Replace it with a clock that advances the pin:

```
every interval
      ↓
read head block identity { number, hash }
      ↓
changed?  ── no ──→ hold
      │ yes
      ↓
new snapshot identity → every read in the enumeration
```

Because the identity is part of the query key, advancing it invalidates and refetches all loaded
pages together. That is the required behavior, and it is not more work than today: the current
interval already refetches every loaded page.

### Reads that belong to one snapshot

Everything comprising one logical enumeration shares the identity:

```
balanceOf(owner) @ N
tokensOfOwnerIn(owner, …) @ N   — every page
ownerOf / getStream / withdrawableAmountOf / statusOf @ N
```

Not every read in the app must share a snapshot. Anything that is one enumeration must.

### Duplicates become an assertion

The dedupe requirement recorded in `2026-08-15-001` was written when duplication looked like the
whole problem. Under a pinned snapshot a duplicate id cannot occur: the index cannot move within one
block. A duplicate therefore means the pin failed or the index is corrupt.

Demote it: detect duplicates, and on detection return `unavailable` with an `incomplete` failure
rather than merging. Do not let it be the mechanism that makes paging correct.

## Result metadata

`ReadOutcomeMetadata` already carries what this needs — `blockNumber?: bigint` and
`blockHash?: \`0x${string}\`` at `web/lib/read-outcome.ts:24-25`. Populate both on every outcome
produced from a pinned enumeration. No new concept.

## Write boundary

A snapshot may be up to one interval old. That is safe for display and unsafe as a precondition.

Before any write that depends on stream ownership — borrow-route, repay, close, claim, withdraw —
read the state the transaction depends on at latest and simulate the exact call. The contract is the
final authority. A transfer five seconds ago must not be able to produce a signed transaction that
the display believed was valid.

## Test accountability

- **Omission under swap-and-pop.** Reproduce the trace in Problem: 1,000 ids, fetch page 1, move the
  token at index 100 out, fetch page 2. Without pinning the moved token is absent; with pinning it
  is present. This is the test that would have caught the defect this plan exists for.
- **Duplicate is fail-closed.** Force a duplicate id across pages and assert the book reports
  `unavailable` with an `incomplete` failure, not a merged list and not a duplicate row.
- **Pin advances on refresh.** Assert that a refresh at an unchanged head block does not refetch,
  and that a changed head block refetches every loaded page against the new identity.
- **Metadata is populated.** Assert `blockNumber` and `blockHash` are both set on a ready outcome
  from a multi-page enumeration, and that both name the same block.
- **Stale-snapshot write.** With a snapshot that says the wallet owns a stream it has since
  transferred away, assert the write path's simulation rejects the transaction rather than the UI
  submitting it.

### Sweep Contracts

Review-blocking. Each line is one rule, tagged with the unit that owns it. Recorded 2026-08-15 from
the ignorance-lens sweep; every rule cites verified evidence.

**Pin plumbing**

- Pin per the superseding note in "Pin by block hash": `{blockHash, requireCanonical: true}`
  primary, `{blockNumber}`-plus-hash-verification as the per-provider fallback, **provider affinity
  for the whole snapshot**. The old send-all-three rule is retired with the wagmi read path. — *pin*
- Assert the block identity on the returned outcome. Never treat the pin as structurally guaranteed. — *pin*
- `classifyRpcFailure` (`web/lib/rpc.ts:28`) gains an unknown-block kind that
  `createOrderedReadTransport`'s `shouldThrow` treats as terminal. Today an unknown-block error
  classifies as `unknown`, so `fallback` fails **over** to the next provider instead of surfacing;
  with `rank: false` each request restarts at provider 0, so pages can split across providers. — *pin*

**Paging**

- Advancing the pin creates a **new query**, not an invalidation of the old one. TanStack reads prior
  pages off the query it is fetching, so a fresh key fetches only `initialPageParam`. Seed the new
  query with the page count already read, or LOAD MORE silently resets to page 1 every tick. — *wall*
- Every pinned read sets `placeholderData: keepPreviousData`. Without it the wall blanks and
  repaints on every pin advance, and `classifyEntry` sees a `loading` stream book. — *wall*
- Pinned enumeration queries carry an explicit short `gcTime` (one or two intervals). The client sets
  no `gcTime` (`web/lib/query-client.ts:17-25`), so TanStack's five-minute default retains up to 20
  dead snapshots, each holding every loaded page. — *wall*

**Readiness and freshness**

- A missing pin is **not** a zero count. Fold pin readiness into each hook's `configured` predicate,
  never into `enabled` alone: all three books default their count to `0n` from `data`, and a disabled
  query is idle rather than loading, so the books return **ready-empty** and `classifyEntry` sends a
  returning holder to first-run — the exact defect plan `001` records as why the last attempt was
  abandoned. — *books*
- A held snapshot is a **success**, not a stale read. The head poll refreshes the freshness anchor on
  every tick whether or not the pin advances. Otherwise `FRESHNESS_MAX_AGE_MS` (45s,
  `web/hooks/useFreshness.ts:14`) expires, `signingAllowed` goes false, and every write control
  disables on data that is current. The seeded Anvil fork mines only on transactions, so this breaks
  the whole watch and borrow E2E tier, not an edge case. — *freshness*
- `readQuery` (`web/lib/query-keys.ts:9-13`) is **unchanged** and keeps `refetchInterval` for its 20
  existing call sites. Pinned hooks use a separate options object. Editing the shared constant
  freezes the ladder, USD price, wallet balances, and `useClock`'s own head poll — which would
  deadlock the snapshot clock. — *query-keys*
- `readQuery` also sets `refetchOnWindowFocus: true`. Re-read head identity before any refetch: a
  backgrounded tab refetches every page against a pin that may have aged out of the node's
  recent-state window. On failure, discard the snapshot and take a fresh pin rather than erroring. — *books*

**Ownership of the clock**

- One exported hook in `web/hooks/` owns the head poll, reusing the `useBlock` query `useChainSkew`
  already runs at `READ_INTERVAL_MS` (`web/hooks/useClock.ts:120-125`). No context provider — that
  violates `ovrflo-web-standard.md` W2. No `watch: true`, which polls at viem's interval and would
  advance the pin roughly every 4 seconds. — *snapshot clock*
- State whether the pin is per-hook or per-account. `useStreams` is mounted twice
  (`WatchApp.tsx:61`, `BorrowFlow.tsx:96`), and `hasCoherentBlock` (`web/lib/actions/borrow.ts:13-27`)
  and `sourceMatchesTarget` (`web/lib/claim-all.ts:243-245`) already demand exact cross-source block
  equality. — *snapshot clock*

**Scope of the snapshot**

- The **stream book is pinned; the lender and borrower books are not.** `lenderPositionAt` and
  `borrowerLoanAt` are append-only (`src/OVRFLOLending.sol:427-429`, `518-519`) — nothing is ever
  removed, indices never shift, and neither book can omit a row. Pinning them triples the blast
  radius for a hazard they do not have. **Key Decision, recorded:** two lenses disagreed; the
  omission hazard is specific to the stream NFT's swap-and-pop, and coherence across books is a
  separate display concern resolved below.
- Because the books then describe different blocks, `borrowerCaughtUp`
  (`WatchApp.tsx:189-192`) stops comparing `dataUpdatedAt` and treats the stream book at any pin as
  authoritative for presence. — *WatchApp*
- The **hydration batch carries the same pin as the id pages.** This is a second query by
  construction: plan `001`'s `contracts(pageParam)` is a pure function of the page index and cannot
  fetch ids and hydrate them in one query. Pinning pages while leaving hydration on `readQuery` still
  stamps a coherent-looking pair. — *useStreams*
- `useLoanStreams` (`web/components/watch/useLoanStreams.ts:50-54`) reads the same lockup on
  unpinned `readQuery`. State whether it joins the stream snapshot. — *useLoanStreams*
- `loadSnapshot`'s `pinnedBlock` parameter (`web/lib/live-action-plan.ts:337`) is **never** fed the
  enumeration pin. It exists for the write path, which must stay at latest. — *write path*

**Writes**

- Post-write refresh **advances the pin** to the captured post-receipt head. Adding
  `"infiniteReadContracts"` to `WAGMI_READ_ROOTS` (`web/lib/invalidate.ts:11`) is necessary — an
  infinite query is invisible to every invalidation path today — but not sufficient: refetching a key
  that still carries the old pin re-reads pre-transaction state. `useWriteFlow` already captures the
  head it needs (`web/hooks/useWriteFlow.ts:200-206`). — *invalidate*
- `WatchApp`'s REFRESH control (`WatchApp.tsx:300-306`) captures a new head and sets the pin before
  refetching. Bare `invalidateQueries` re-reads the same block and does nothing visible. — *WatchApp*

**Presentation**

- `ReadOutcomeMetadata` gains `blockTimestamp?: bigint` from the pinned block, and `lastReadAt`
  (`WatchApp.tsx:143`) uses it when present. Ledger-card interpolation is anchored to `asOf`
  (`web/lib/ledger-card.ts:102-111`); on a held snapshot a wall-clock anchor keeps advancing the
  streamed bar against a block that cannot have streamed anything. The write path already sets this
  precedent (`live-action-plan.ts:344`). — *ledger-card*
- Fail-closed means the corrupt page is never merged, **not** that the wall empties. `useLastKnown`
  (`WatchApp.tsx:444-451`) keeps painting the previous snapshot behind the degraded caption. — *wall*

**Dependency**

- This plan assumes the paged hook from `2026-08-15-001`. Nothing in `web/` uses
  `useInfiniteReadContracts` today, and `useStreams.ts:147-149` still **disables enumeration
  entirely** above `MAX_ENUMERATION_IDS` (500) — so the plan's 1,000-id example is a state today's
  code refuses to reach. State whether pinning replaces that budget gate or layers under it. Build
  order is settled in the header: `001` and this plan are **one change**, so do not stop and report
  when `001` is absent — build them together. — *useStreams*
- `tokensOfOwnerIn` reverts `SablierV2Lockup_InvalidQueryRange` when `start >= stop`. A
  `getNextPageParam` that emits a final `start === balance` page reverts rather than returning
  empty. — *pager*

### Test placement, corrected

The five scenarios in Test accountability need placements the plan did not give:

- **Omission (scenario 1)** is an **E2E** scenario, not Vitest. The Vitest harness mocks `wagmi` and
  returns one fixed object per function name (`web/tests/hooks/useStreams.enumerable.test.ts:50-61`),
  so it cannot express "page 1 saw one index map, page 2 saw another" — a mocked version passes
  identically with and without pinning. Run it with an **injectable page size** over a handful of
  real streams; 501 deposits is not viable.
- **Omission needs a control arm.** Assert the same fixture read at `latest` *does* lose the id,
  before trusting the pinned assertion. Otherwise the test passes even when the fixture never moves
  anything.
- **Pin advances (scenario 3)** must assert the **app-level** decision, not a library invariant. That
  an unchanged pin is an unchanged key is guaranteed by wagmi. Capture the config objects passed to
  the read hooks and assert a changed head produces a new `blockHash` on every one of them.
- **Metadata (scenario 4)** asserts that **every** lockup read config in one enumeration — id pages
  and hydration batch — carries the same `blockHash`, and that the stamped metadata equals it.
  Asserting only the stamp is satisfied by the split-pin bug it should catch.
- **Stale write (scenario 5)** targets `buildAction`, not `simulate`. Stale ownership is rejected at
  `web/lib/actions/borrow.ts:66-69` as `stream-not-owned`, before `runtime.simulate` is reached
  (`web/lib/action-runtime.ts:265`). The write boundary already reads at latest
  (`live-action-plan.ts:340`); this test pins existing behavior rather than building new.
- **Post-write staleness** needs `streams.feature` AE2 to drop its `page.reload()` between the pledge
  and the absence assertion (`web/tests/e2e/steps/common.ts:65-68`). A remount re-pins, so the
  scenario passes today whether or not invalidation works.

## Files (when built)

- `web/hooks/useStreams.ts`, plus the new head-identity hook in `web/hooks/`
- `web/components/watch/WatchApp.tsx` — `borrowerCaughtUp`, `lastReadAt`, the REFRESH control
- `web/lib/read-outcome.ts` — `blockTimestamp` on `ReadOutcomeMetadata`
- `web/lib/invalidate.ts` — the `infiniteReadContracts` root
- `web/lib/rpc.ts` — the unknown-block failure class
- **Maps, and these are gated, not optional:** `docs/maps/state/keys/chain-reads.md` (the
  `chain.stream-truth` entry and its freshness note), `docs/maps/ui/watch.md`, and the
  **regenerated** `docs/maps/state/functions/INDEX.md`.
- Tests per Test accountability, including the E2E scenario and its control arm

`npm --prefix web run lint:maps` **fails** any change under `web/components/` or `web/hooks/` that
does not also change `docs/maps/ui/**`, `docs/maps/state/keys/**`, or a numbered ADR
(`docs/maps/REVIEW.md:161-178`). A change under `state/keys/**` must also regenerate
`docs/maps/state/functions/INDEX.md` — **regenerate it, never hand-patch**, which
`docs/maps/SCHEMAS.md:128-130` bans.

## Verification (when built)

1. `npm --prefix web run test`. Precondition: a fork checkout at `../OVRFLO-Streams` or
   `OVRFLO_STREAMS_PATH`, with `npm install` already run there. `pretest` runs
   `check-ovrflo-stream-bytecode.mjs`, which does a full `forge build` in a detached worktree and
   hard-exits without it. A failure here is an environment condition, not a broken premise.
2. `npm --prefix web run lint:maps`.
3. `npm --prefix web run test:e2e` against a seeded local fork, including the omission scenario and
   its unpinned control arm.
4. `npm --prefix web run build`.

## The normative freshness ladder needs an exception

`docs/maps/SCHEMAS.md` freshness precedence rung 3 reads: *an RPC read at an equal-or-newer block may
replace optimistic or derived local effects; a read at an older block may not.* This plan makes the
stream book an older-block read **by design**, leaves the lender and borrower books at latest, and
tells `borrowerCaughtUp` to treat the stream book at any pin as authoritative for presence. That is
a direct conflict with a normative document.

`docs/maps/state/keys/chain-reads.md:219-222` separately records the current freshness rule for
`chain.stream-truth` as `dataUpdatedAt` past `maxAgeMs` → discard. This plan replaces that anchor
with a block timestamp.

Amend rung 3 with a named pinned-enumeration exception and rewrite the `chain.stream-truth`
freshness note. `SCHEMAS.md` §2 escalates trust and freshness changes to the Owner, so **confirm
whether a numbered ADR is required before writing the amendment** — do not decide it silently.

## Out of scope

- Contract changes. See `2026-08-15-002`.
- The lens/periphery read contract. It would collapse the hydration calls and make a snapshot atomic
  in one call, which strengthens this design rather than replacing it. Separate decision.
- Extending snapshot coherence to market-wide reads (ladder, config). Noted as a follow-on: the same
  identity concept generalizes to a `MarketSnapshot`, but this plan covers account enumeration only.
- Any indexer or `eth_getLogs` discovery. Excluded by streams-plan R12.
