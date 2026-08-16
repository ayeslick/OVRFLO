# Watch enumeration load more

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Origin: user reversal of streams-plan R16 / KTD4 after campaign review finding #12.
Does not edit `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`.

## Problem

Markets refuses the whole Streams (and Borrowed / Supplied) book when the wallet holds more than `MAX_ENUMERATION_IDS` (500) ids. The user then sees no rows and cannot sign. That is worse than a long list. Stream NFTs are transferable, so incoming transfers can trip the cap.

The old rule exists to stop a silent truncated list. The old paging attempt died for a different reason: viewport staging marked "ids known, zero rows hydrated" as confirmed-empty. The watch entry gate then sent the holder to first-run and never hydrated.

## Product contract

- A holder who has streams must see streams. The book must not go unavailable only because `balanceOf` (or loan/position count) is greater than 500.
- Page 1 hydrates fully before the book is `ready`. The entry gate must not see a ready-empty book while unread ids remain.
- The wall shows a `LOAD MORE` control when unread ids remain. The control fetches and hydrates the next page and appends rows. No lens-tab count. No "500 of N" badge.
- Per-row actions (withdraw, borrow-route, repay, close, claim) run on hydrated rows only. Those actions stay allowed while more pages exist.
- Confirmed-empty (hide the lens, first-run) is allowed only after every id is read and zero render-eligible rows remain, or the on-chain count is zero.
- If page 1 hydrates to zero render-eligible rows and more ids remain, Markets fetches the next page without a click. Spam NFTs at the start of Enumerable must not hide a later eligible stream behind a click the user never sees.
- Transport failure on a page still marks that book unavailable. A partial list from a failed page is not ready.

## Approach

Do not hand-roll a pager. The tree already has the two battle-tested pieces.

1. **On-chain page.** `tokensOfOwnerIn(owner, start, stop)`, already on the lockup. One call returns one window of ids. `start` and `stop` are **the owner's enumeration indices, not token ids** — the fork builds on OpenZeppelin `ERC721Enumerable` and loops `tokenOfOwnerByIndex`, and it clamps `stop` to `balanceOf(owner)` (OVRFLO-Streams `src/abstracts/SablierV2Lockup.sol:127-153`). The name matches ERC721AQueryable; the behavior does not. Do not write a global-token-id cursor.
2. **Client page.** TanStack `useInfiniteQuery` directly (`@tanstack/react-query@5.90.12`, already a
dependency). The wall uses `fetchNextPage` / `hasNextPage` / `isFetchingNextPage`. The page size is
`STREAM_PAGE_SIZE` (25, `web/lib/lending-math.ts`), owned by `2026-08-15-004`. `MAX_ENUMERATION_IDS`
(500) is today's refusal threshold, not a page size; it is retired when this plan lands.
**Not wagmi `useInfiniteReadContracts`** (corrected 2026-08-15): that hook takes addressed contract
descriptors and executes them through `readContracts`/multicall, which cannot represent a deployless
`{code, data}` call — and the lens from `2026-08-15-005` is deployless. The split from `008`:
TanStack owns `pageParams`, `hasNextPage`, `fetchNextPage`, cache, and in-flight state; the
`queryFn` is the protocol client's `loadStreamPage(client, owner, start, stop, pin)`, which makes
the viem `call({ code, data })` and decodes the result.

Streams: `useReadContract` `balanceOf`, then `useInfiniteQuery` whose `queryFn` is **one lens call
per page** — `loadStreamPage` calling `streamsOfOwnerIn(lockup, owner, pageParam, pageParam +
STREAM_PAGE_SIZE)`, which returns ids and row data together in one pinned read. Do not build a
per-id hydration batch (`ownerOf` / `getStream` / `withdrawableAmountOf` / `statusOf` fan-out); the
lens exists to delete that shape. `getNextPageParam` returns the next start index while
`start + pageSize < balanceOf`, else `undefined`.

Borrowed / Supplied: the same pattern over `borrowerLoanAt` / position index windows. Those are
addressed contract reads (not deployless), so wagmi's `useInfiniteReadContracts` remains legal
there — but use the same `useInfiniteQuery`-plus-protocol-client shape for symmetry. Same
`LOAD MORE` wired to `fetchNextPage`.

Do not add Alchemy, The Graph, or another indexer. Stream discovery stays on-chain (streams-plan R12).
Do not add `@tanstack/react-virtual` or an intersection observer. A wall `LOAD MORE` control is enough.
Do not store page cursors in React state. TanStack owns `pageParams`.
Do not treat `hasNextPage` as confirmed-empty. Incomplete is `ready` plus `hasNextPage`, or `loading` while page 1 is in flight.

**Pin every page of one enumeration to one block.** Owner enumeration indices are not stable. `ERC721Enumerable` swaps the owner's last token into a vacated slot when a token is burned or transferred away, so ids after the removed one shift index. Streams burn on depletion, so this happens in normal use. Pages are separate requests, so an id can move *behind* a page already fetched and be returned by no page at all — a silently missing stream, not a duplicate. Deduplication cannot repair that, and neither can `ownerOf` verification, because the client never receives the id. The correctness mechanism is a pinned block identity across all pages, specified in `2026-08-15-003-feat-snapshot-pinned-enumeration-plan.md`. Build that before or with this plan.

**Pagination progress is defined by the source coordinate, never by the number of usable rows
returned** (adopted 2026-08-15 from the zFi review). The cursor advances by the enumeration window
inspected, even when a window yields zero render-eligible rows. Two regression cases pin it: a
window with more eligible rows than the display consumes must resume at the first unconsumed source
index (or entries disappear forever), and an all-ineligible window must still advance the cursor
(or pagination stalls). `2026-08-15-004` tests both.

**Treat a duplicate id as an invariant violation, not a merge.** Under a pinned snapshot the index cannot move, so a duplicate means the pin failed or the index is corrupt. Return `unavailable` with an `incomplete` failure. Do not silently keep the first occurrence.

The only OVRFLO glue: if page 1 hydrates to zero render-eligible rows and `hasNextPage` is true, call `fetchNextPage` (TanStack's own race rule: only when `!isFetching`). That is product policy on top of the hook, not a second pager.

## Every consumer must declare complete-set or loaded-window

Paging changes what the streams array *means*. Today it is the wallet's complete holdings; after
this plan it is whichever pages have been fetched. Six call sites read it, and none of them says
which it needs. Two produce a wrong action rather than a wrong display.

**Correctness-critical — these must force complete enumeration before acting, or say plainly that
they operate on the loaded window:**

- **`web/lib/claim-all.ts:79`** builds the claim queue from `input.streams` filtered on
  `withdrawable > 0n`. On a partial list, CLAIM ALL claims the loaded pages, reports success, and
  silently leaves the rest unclaimed. The user is told everything is claimed. This is money.
- **`web/components/borrow/BorrowFlow.tsx:760`** returns the `"empty"` stage when
  `streams.data.streams.filter((row) => row.borrowRouteEligible).length === 0`. A wallet whose only
  eligible stream sits on page 3 is told it has none and cannot borrow at all. The same filter at
  `:106` feeds the selectable list, so those streams are also unpickable.

**Count semantics — one field cannot carry both meanings (corrected 2026-08-15).** A wallet holding
20 NFTs, all render-ineligible, with every page exhausted, is *confirmed empty* while `balanceOf`
is 20 — so "count stays `balanceOf`" and "confirmed-empty after exhaustion" cannot share one field.
The book state model separates them explicitly:

- `sourceCount` — the on-chain `balanceOf` (or loan/position count). Protects against false-empty
  while enumeration is incomplete.
- `renderCount` — render-eligible rows loaded so far. Display only, never an emptiness signal.
- `complete` — every page fetched (`hasNextPage` false and no page failed).
- `confirmedEmpty` — `sourceCount == 0`, **or** `complete && renderCount == 0` **with zero
  unresolved failures** (no failed page, no `ok: false` row, no invariant violation). A book that
  exhausted its pages but dropped rows to hydration failures is `unavailable`, not empty — a
  transient failure must never become an assertion that the user owns nothing. This, and only
  this, may send a holder to first-run or hide the lens.

**`sourceCount` must stay the on-chain `balanceOf`, never the number of loaded rows:**

- **`web/lib/watch-entry.ts:49`** returns `"first-run"` on `streams.status === "ready" && count === 0`.
  If `count` becomes loaded rows, a holder whose first page is entirely ineligible lands on the
  first-run screen. That is the failure this plan already records as why the previous attempt was
  abandoned.
- **`web/components/watch/WatchApp.tsx:206`** derives the `"empty"` surface state from
  `wallBook.count === 0`. Same requirement.

**Restate for per-page semantics:**

- **`web/hooks/useStreams.ts:375`** fails closed on `anyFailure && streams.length === 0 && ids.length > 0`.
  Under paging this is a per-page condition, and the plan must say whether one bad page makes the
  whole book unavailable or only that page.
- **`web/components/watch/Wall.tsx:268`** builds the lens tab from the streams array. The product
  contract already forbids a count badge, so confirm the tab derives visibility from `count`, not
  from `streams.length`.

**The rule:** a consumer that acts on the set needs the complete set. A consumer that renders rows
needs only the window. Every call site above states which, in the code, at the point of use.

**The complete-set mechanism** is the lens (`2026-08-15-005`): `streamsOfOwner` in one call, with the
whale fallback of merging `streamsOfOwnerIn` windows at one pinned block. Complete-set consumers do
not page the wall's infinite query.

## Out of scope

- Changing lockup mint, transfer, or burn.
- Raising or removing the per-page multicall budget.
- A numeric remaining count on the lens tabs.
- Claim-all or any action that assumes the unread tail.

## Files (when built)

- `web/hooks/useStreams.ts`, `web/hooks/useBorrowerBook.ts`, `web/hooks/useLenderBook.ts`
- `web/components/watch/Wall.tsx`, `web/components/watch/WatchApp.tsx`
- `web/components/borrow/SelectStream.tsx` (same incomplete-list honesty)
- Maps: `docs/maps/ui/watch.md`, `docs/maps/state/keys/chain-reads.md`
- Tests beside those hooks and `web/tests/watch/`

## Verification (when built)

- `balanceOf == 501`: page 1 ready with rows; `LOAD MORE` reveals the last id; book is not unavailable.
- Page 1 all ineligible, page 2 has one eligible stream: auto-fetch shows that stream with no click.
- Count 0: confirmed empty, unchanged.
- Mid-page RPC failure: unavailable, not ready-empty.
- An id whose index shifts behind an already-fetched page (burn at a low index between page 1 and page 2): the stream still appears on the wall. This is the omission case; a dedupe-only design fails it.
- An id present in both page 1 and page 2: the book reports `unavailable`, not a merged list and not a duplicate row.
- First-run still requires all three books confirmed empty, including exhausted stream pages.
