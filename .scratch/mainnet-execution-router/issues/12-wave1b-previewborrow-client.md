# 12 — Wave 1B: `previewBorrow` protocol client + ABI regen (no bump)

**What to build:** The web half of `007`: regenerate the ABI (additive, no `ABI_VERSION` bump),
add the quote read to the protocol client, replace the mirrored math, convert BorrowFlow's
render-time arithmetic into the async quote with the plan's interaction shape.

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** 08 | **Status:** resolved — merged (impl 601aba4 + fix e25b70c). Review: reject then approve. Residuals: cap keepPreviousData after tick change; signingBlocked omits isStale. | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.5-high`, subagent_type `generalPurpose`

## Session prompt

```text
Implement the web half of docs/plans/2026-08-15-007-feat-borrow-quote-by-revert-plan.md (body =
previewBorrow; the filename is stale; nothing touches BelowMinAcceptable or classifyBorrowError).
Ticket: .scratch/mainnet-execution-router/issues/12-wave1b-previewborrow-client.md
Spec: .scratch/mainnet-execution-router/spec.md.

CWD: all forge/npm/vitest/typegen/git run in /Users/jay/OVRFLO-t12 (web tests: that path/web,
local vitest binary). Echo pwd + git toplevel + HEAD in the same command as the test. Wrong-tree
totals are void.

Before first write: echo branch + HEAD; confirm previewBorrow exists in src/ (ticket 08 landed);
web test baseline totals.

Binding:
- Regenerate web/lib/generated.ts: one function added, no error changed, ABI_VERSION stays 1.
- Delete the five mirrored functions from web/lib/lending-math.ts and their tests. quote.ts is a
  mixed module: replace ONLY quoteBorrow (→ previewBorrow read) and streamDerivedCap (→ MAX =
  previewBorrow with type(uint128).max target); the other nine exports stay.
- Quote is a TanStack query keyed {chainId, lending, market, streamId, aprBps, targetBorrow} —
  latest-request-wins by construction. Debounce the amount input, not the tick selection.
- In-flight quote shows previous figures marked stale — never zero, never blank.
- Composed figures come from BorrowQuoteSnapshot {block:{N,H}, actualBorrow, fee, obligation,
  streamRemaining, residual} with every constituent read at block N (streamsByIds([streamId]) at
  quote time via ticket 11's client if landed; otherwise label snapshot-derived and log a
  deviation for ticket 14 follow-up).
- Write boundary unchanged: real borrow simulation with the user's minAcceptable stays the
  transaction authority.
- Tests: decoded preview equals subsequent borrow's event (Vitest against anvil or recorded
  fixtures per repo convention); in-flight-never-zero; debounce-one-quote-per-pause.

Intent record before first write. Do not edit plans. Do not push.
```

## Owns / does not own

**Owns:** ABI regen, quote read + query, lending-math deletion, quote.ts surgery, BorrowFlow
async conversion, its tests.
**Does not own:** Solidity (08), stream lens client (11), wall pager (14).

## Acceptance criteria

- [x] ABI regenerated additively; ABI_VERSION untouched; classifyBorrowError untouched
- [x] Five mirrored functions and tests gone; quote.ts's nine presentation exports intact
- [x] Latest-request-wins, stale-not-blank, and debounce behaviors tested
- [x] Web suite green, totals pasted; deviations recorded; Final diff filled

## Deviations from the plan

- Plan said five mirrors; seven deleted (`factor` through `netToBorrower`). `upfrontBps` inlines factor; `positions.ts` unchanged.
- `streamRemaining` / `residual` snapshot-derived until `streamsByIds` (ticket 14 follow-up).
- e2e `chain.ts` keeps a local `grossPrice` for UNIT-alignment search only.
- Maps not updated (gated, not owned).
- Review residuals (non-blocking): cap query still `keepPreviousData` across tick change; `signingBlocked` omits `preview.isStale` (`onBorrow` still returns).

## Final diff

Implement: `601aba4` `feat(web): Quote borrow via previewBorrow`
Fix: `e25b70c` `fix(web): Align quote client types and stale path`
Merge: `c01b7d5` onto `feat/008-mainnet-campaign`.

Review: reject (tsc + stale quote) then approve on the fix.

## Plan unit

`007` web half, wave 1B.
