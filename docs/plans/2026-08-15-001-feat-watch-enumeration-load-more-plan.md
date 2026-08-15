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
2. **Client page.** wagmi `useInfiniteReadContracts` (docs: https://wagmi.sh/react/api/hooks/useInfiniteReadContracts). Markets already depends on `wagmi@3.7.3` and `@tanstack/react-query@5.90.12`. That hook is TanStack `useInfiniteQuery` with multicall. The wall uses `fetchNextPage` / `hasNextPage` / `isFetchingNextPage`. `MAX_ENUMERATION_IDS` (500) is the **page size** in `getNextPageParam`, not a refusal.

Streams: `useReadContract` `balanceOf`, then `useInfiniteReadContracts` whose `contracts(pageParam)` builds the hydration batch for `tokensOfOwnerIn` ids in `[pageParam, pageParam + pageSize)`. `getNextPageParam` returns the next start index while `start + pageSize < balanceOf`, else `undefined`.

Borrowed / Supplied: the same hook over `borrowerLoanAt` / position index windows. Same `LOAD MORE` wired to `fetchNextPage`.

Do not add Alchemy, The Graph, or another indexer. Stream discovery stays on-chain (streams-plan R12).
Do not add `@tanstack/react-virtual` or an intersection observer. A wall `LOAD MORE` control is enough.
Do not store page cursors in React state. TanStack owns `pageParams`.
Do not treat `hasNextPage` as confirmed-empty. Incomplete is `ready` plus `hasNextPage`, or `loading` while page 1 is in flight.

**Pin every page of one enumeration to one block.** Owner enumeration indices are not stable. `ERC721Enumerable` swaps the owner's last token into a vacated slot when a token is burned or transferred away, so ids after the removed one shift index. Streams burn on depletion, so this happens in normal use. Pages are separate requests, so an id can move *behind* a page already fetched and be returned by no page at all — a silently missing stream, not a duplicate. Deduplication cannot repair that, and neither can `ownerOf` verification, because the client never receives the id. The correctness mechanism is a pinned block identity across all pages, specified in `2026-08-15-003-feat-snapshot-pinned-enumeration-plan.md`. Build that before or with this plan.

**Treat a duplicate id as an invariant violation, not a merge.** Under a pinned snapshot the index cannot move, so a duplicate means the pin failed or the index is corrupt. Return `unavailable` with an `incomplete` failure. Do not silently keep the first occurrence.

The only OVRFLO glue: if page 1 hydrates to zero render-eligible rows and `hasNextPage` is true, call `fetchNextPage` (TanStack's own race rule: only when `!isFetching`). That is product policy on top of the hook, not a second pager.

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
