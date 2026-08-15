# Enumeration omission E2E

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Serves `2026-08-15-003-feat-snapshot-pinned-enumeration-plan.md`. Build with it, not after.

## Why this test exists

Plan `003` makes one claim: pinning every page of an enumeration to one block prevents a held stream
from disappearing from the wall. Nothing verifies that claim today, and the failure it prevents is
silent — no revert, no error, no degraded caption. A stream the wallet owns is simply not rendered,
and every per-row action on it is unreachable.

The trace, from `003`:

```
page 1 reads owner indices [0, P)
      ↓
the stream at a low index leaves the wallet
      ↓
swap-and-pop moves the LAST stream into that low slot
      ↓
page 2 reads [P, balance)
      ↓
the moved stream sits behind the boundary page 1 already passed
      ↓
returned by neither page
```

`ownerOf` cannot catch it: the client never receives the id. Deduplication cannot catch it: nothing
is duplicated. This test is the only thing that can.

## Why it cannot be a Vitest case

Two structural reasons, both verified.

**The unit harness cannot express a mid-enumeration change.** `web/tests/hooks/useStreams.enumerable.test.ts:50-61`
mocks the whole `wagmi` module and routes every `tokensOfOwnerIn` call to one fixed return object.
The trace requires page 1 and page 2 to observe *different* index maps. One fixed answer cannot.

**The unit tier never reaches the pin.** No hook test in the tree constructs a wagmi `Config` or a
transport, so nothing in Vitest exercises viem's `blockHash` parameter — which is the mechanism under
test.

The consequence is why this is a finding rather than a preference: **a mocked version of this test
passes identically with and without pinning.** It would occupy a line in the test-accountability
ledger while guarding nothing — the exact failure recorded at
`docs/solutions/patterns/ignorance-lens-sweep.md` ("a test-accountability entry named units that did
not contain the scenario").

## Prerequisite: the page size becomes injectable

Every stream in E2E is a real vault deposit (`web/tests/e2e/steps/streams.ts:53-58`). At today's
constant the trace needs 501 deposits, which is not a viable scenario.

`MAX_ENUMERATION_IDS = 500n` (`web/lib/lending-math.ts:9`) is **not a page size today.** It is a
refusal threshold: `useStreams.ts:149` sets `overBudget = balance > MAX_ENUMERATION_IDS` and
`useStreams.ts:156` then reads `tokensOfOwnerIn(account, 0n, balance)` — every id in one call — or,
above the threshold, refuses to enumerate at all and reports the book unavailable. `useLenderBook.ts:83`
and `useBorrowerBook.ts:45` use the same constant the same way.

Plan `001` turns it into a genuine page size. That is a change of meaning, so it should be a change
of name as well: a constant called `MAX_ENUMERATION_IDS` that no longer caps enumeration will
mislead every later reader.

**Introduce `STREAM_PAGE_SIZE` and make it injectable**, following the precedent already in the same
file — `enumerateIds(nextId, maxIds = MAX_ENUMERATION_IDS)` (`web/lib/lending-math.ts:144`) already
takes the bound as a defaulted parameter.

Recommended default: **25**.

| ids per page | contract calls | HTTP requests | first paint |
|---|---|---|---|
| 500 | 1 + 2,000 | ~72 | slow |
| 100 | 1 + 400 | ~15 | acceptable |
| **25** | 1 + 100 | **~4** | one wave |

Hydration is four reads per id (`ownerOf`, `getStream`, `withdrawableAmountOf`, `statusOf`), and viem
chunks multicall calldata at 1,024 bytes — about 28 calls per request. Total request volume across a
whole wallet is roughly linear in id count whatever the page size, so the page size buys **time to
first row**, not total traffic. 25 pays about four requests to paint the first page instead of
seventy-two.

The cost is more LOAD MORE clicks for large holders. The auto-advance rule already in `001` — fetch
the next page without a click when a page hydrates to zero eligible rows — absorbs the spam case,
which is the common one.

For the test, inject **2**.

## The scenario

Lives in `web/tests/e2e/streams.feature`, matching the existing Given/When/Then style.

```gherkin
Scenario: Omission — a stream that moves behind a fetched page still appears
  Given the wallet holds 3 streams
  And the stream page size is 2
  When I read the first page of streams
  And the stream at index 0 leaves the wallet
  And I read the next page of streams
  Then I see all remaining held streams on the wall
  And the wall shows no duplicate stream row
```

With page size 2 over 3 streams: page 1 covers indices 0–1. Removing index 0 moves the stream at
index 2 into slot 0. Page 2 covers index 1 onward. The moved stream is behind the boundary. That
reproduces the trace at three deposits instead of 501.

## The control arm — not optional

The pinned assertion above **passes even if the fixture never moves anything**. A scenario that sets
up wrongly and asserts "all streams present" is green for the wrong reason, and looks like coverage
forever.

So the same feature carries its negative:

```gherkin
Scenario: Omission control — the same sequence loses a stream when unpinned
  Given the wallet holds 3 streams
  And the stream page size is 2
  And enumeration pinning is disabled
  When I read the first page of streams
  And the stream at index 0 leaves the wallet
  And I read the next page of streams
  Then one held stream is missing from the wall
```

This requires a test-only switch that reads pages at `latest` instead of at the pin. It proves the
fixture reproduces the bug before the positive assertion is trusted.

**If the control arm cannot be made to fail, the positive scenario is not evidence.** Treat a green
control as a broken fixture, not as good news.

## How the stream leaves mid-enumeration

The step "the stream at index 0 leaves the wallet" needs a transfer between the two page reads. Two
mechanisms exist in the fixture layer; pick one and record which:

- `transferFrom` from the test wallet to a second address, which is what a pledge does in production.
- `withdrawMax` to depletion followed by `burn`, which is the path a settled stream takes.

The transfer is simpler and exercises the same swap-and-pop. Prefer it, and note that burn reaches
the identical removal branch, so one scenario covers both.

## Files (when built)

- `web/lib/lending-math.ts` — `STREAM_PAGE_SIZE`, injectable; `MAX_ENUMERATION_IDS` retired or
  renamed at its three call sites
- `web/hooks/useStreams.ts`, `web/hooks/useLenderBook.ts`, `web/hooks/useBorrowerBook.ts`
- `web/tests/e2e/streams.feature` — both scenarios
- `web/tests/e2e/steps/streams.ts` — the page-size, pin-disable, and mid-enumeration-transfer steps
- Maps, gated: `docs/maps/state/keys/chain-reads.md`, and the regenerated
  `docs/maps/state/functions/INDEX.md` (see `003`, Files)

## Verification (when built)

1. The control scenario **fails** — one stream missing — with pinning disabled.
2. The positive scenario **passes** with pinning enabled, same fixture.
3. Flipping the pin off turns the positive scenario red. If it stays green, the pin is not reaching
   every read in the enumeration and `003`'s hydration rule is not satisfied.
4. `npm --prefix web run test:e2e` green overall against a seeded local fork.

## Out of scope

- The pinning implementation itself. See `003`.
- The pager. See `001`.
- Any contract change. See `002`.
- Reorg behaviour: Anvil serves EIP-1898 but the E2E runtime builds a single transport
  (`web/tests/e2e/support/WalletRuntime.tsx:63`), so fallback and reorg paths cannot be covered here.
  `003`'s Sweep Contracts routes that to a Vitest case over a two-transport `fallback`.
