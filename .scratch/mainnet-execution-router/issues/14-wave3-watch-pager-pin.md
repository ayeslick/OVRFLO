# 14 — Wave 3: Watch pager + snapshot pin (`001` + `003` as one change)

**What to build:** The Watch wall's LOAD MORE pagination on the lens protocol client, pinned per
`003`: TanStack `useInfiniteQuery` whose `queryFn` is `loadStreamPage`, snapshot pin in the query
key, the four-field state model, factory-wide Watch scope. `001` and `003` land as one change —
an unpinned pager and a pin with no pager are both unshippable. Plans (both post-sweep):
`2026-08-15-001-...` and `2026-08-15-003-...`.

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** 05, 11, 13 | **Status:** resolved — merged `7be16d2` (impl `6b1fb8f`, reject fixes `63c8dcd`, orchestrator fix `58ac648` for the approve-with-fixes empty-book hole). Re-review verdict: approve-with-fixes; the one P2 (unavailable empty book erasing last-known rows) was fixed by the orchestrator after two Grok fix failures. No ticket 15; campaign complete. | **Labels:** done

**Pinned model:** `cursor-grok-4.6-xhigh`, subagent_type `generalPurpose`

## Session prompt

```text
Implement docs/plans/2026-08-15-001-feat-watch-enumeration-load-more-plan.md and
docs/plans/2026-08-15-003-feat-snapshot-pinned-enumeration-plan.md as one change (both
post-sweep).
Ticket: .scratch/mainnet-execution-router/issues/14-wave3-watch-pager-pin.md
Spec: .scratch/mainnet-execution-router/spec.md.

CWD: all forge/npm/vitest/typegen/git run in the ticket worktree named at dispatch (web tests:
$WORKTREE/web, local vitest binary). Echo pwd + git toplevel + HEAD in the same command as the
test. Wrong-tree totals are void.

Worktree load: new worktrees have no web/node_modules, no web/.env.local, no Foundry out/.
Load those before baseline (symlink or npm ci; copy env from /Users/jay/OVRFLO/web/.env.local
without printing it; forge build). Missing deps is bootstrap, not a failed baseline.

Before first write: echo branch + HEAD; web test baseline; confirm tickets 11 and 13 are resolved
(protocol client + factory bootstrap exist) — if not, STOP.

Binding:
- TanStack owns the pager state machine (pageParams, hasNextPage, fetchNextPage, cache); the
  protocol client owns the page operation. Do not hand-roll a pager; do not move the state
  machine below React.
- Pin: one provider per snapshot; {blockNumber, blockHash} captured once; primary
  {blockHash, requireCanonical:true} where the ticket-11 probe says the provider honors it, else
  {blockNumber} + post-acceptance hash verification; provider failure discards the snapshot and
  restarts page one on the next provider. Re-pin on block-not-found: fresh pin, restart page one;
  the previous rendered list stays visible marked stale until the new page one arrives.
- Pagination progress by SOURCE COORDINATE: cursor advances by enumeration window inspected, even
  when zero rows are render-eligible; auto-fetch continues on an all-ineligible page. Regression
  cases: resume at first unconsumed source index; empty window still advances.
- State model: sourceCount, renderCount, complete, confirmedEmpty (requires zero unresolved
  failures). Duplicate id in one snapshot = invariant violation -> unavailable, no dedup.
- Watch is factory-wide: aggregate books across ALL lending contracts from ticket 13's discovery;
  keys are (chainId, lendingAddress, id). markets[0].lending is a hard stop.
- Work rate: sequential cancellable page loads; obsolete loads cancel on re-pin.
- LOAD MORE is a wall control; no intersection observer. Borrowed/Supplied keep their addressed
  reads but adopt the same outcome shape.
- Wall pager tests mock the protocol client, not the transport.

Intent record before first write. Do not edit plans. Do not push.
```

## Owns / does not own

**Owns:** wall pager hook + UI wiring, pin lifecycle, state-model consumers on the wall,
factory-wide aggregation, their tests.
**Does not own:** protocol client internals (11), bootstrap (13), E2E (15).

## Acceptance criteria

- [ ] Pager on useInfiniteQuery + loadStreamPage; pin in the query key
- [ ] Source-coordinate regression cases green (resume-at-unconsumed, empty-window-advances)
- [ ] Re-pin restart + stale-render behavior tested; provider-affine snapshot tested
- [ ] Four-field state model rendered; confirmedEmpty honest under injected failures
- [ ] Factory-wide aggregation with composite keys; suite green, totals pasted
- [ ] Deviations recorded; Final diff filled

## Deviations from the plan

- `streamsByIds` remaining/residual at the quote pin: not this ticket.
  Quote `simulateContract` is latest. A third pin would block the pager.
- SCHEMAS.md freshness rung 3 pin exception: not amended. `chain.stream-truth`
  notes that a held pin is success. Owner ADR left for later.
- Multi-provider snapshot client: not added. `.env.local` is one loopback URL.
  `unknown_block` is terminal so a reorged pin cannot split pages. Generic
  transport errors can still failover on wagmi fallback.
- Factory lending pages read counts, then each `load*Page` reads count again.
  Extra RPC. Acceptable for this ticket.

## Final diff

Worktree `/Users/jay/OVRFLO-t14`, branch `ticket/14-watch-pager-pin`, HEAD still
`c01b7d5` (uncommitted). `npm --prefix web run typecheck` clean. `npm test` in
`/Users/jay/OVRFLO-t14/web`: **859 passed / 115 files**.

See implementer `git diff --stat c01b7d5` plus untracked
`useCompleteStreams.ts`, `useEnumerationPin.ts`, `protocol/lending.ts`,
`stream-book.ts`, `watch-lendings.ts`, and new unit tests.

## Plan unit

`001` + `003`, wave 3. Gates ticket 15.
