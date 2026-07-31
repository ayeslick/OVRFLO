---
title: "Blanket hasError flag hid on-chain LENDING/BORROWING positions when only stream discovery failed"
category: ui-bugs
module: web/components/PositionList.tsx, web/hooks/useHeldStreams.ts
date: 2026-07-28
problem_type: ui_bug
component: nextjs_react
symptoms:
  - "Playwright e2e 'Happy path' supply test flakes: a LIQUIDITY position just created on-chain by supplyLiquidity() is invisible after the transaction confirms"
  - "Entire PositionList is replaced by a blanket 'UNABLE TO LOAD POSITIONS' message whenever any one of three independent data sources errors"
  - "A failed or incomplete stream-discovery projection hides successfully-created LENDING/BORROWING positions that came from unrelated on-chain reads"
  - "No way to distinguish an on-chain RPC read failure from a stream-discovery failure in the rendered UI"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [position-list, discovery, error-handling, error-isolation, wagmi, e2e-flake]
---

# Blanket hasError flag hid on-chain LENDING/BORROWING positions when only stream discovery failed

## Problem

`PositionList` (`web/components/PositionList.tsx`) collapsed the error states of three independent data sources into a single `hasError` flag, so when stream discovery failed while the on-chain lending reads succeeded, the entire position list — including positions that had just been created on-chain — was replaced with one blanket "UNABLE TO LOAD POSITIONS" message.

(Originally the STREAMS path depended on a Ponder indexer; after the on-chain discovery cutover it depends on browser-side projection in `web/lib/discovery/`. The failure-domain split is what matters.)

## Symptoms

- `PositionList` rendered `UNABLE TO LOAD POSITIONS` and hid all LENDING, BORROWING, and STREAMS groups whenever *any* of `liquidity.error`, `loanBook.error`, or `streams.error` was truthy, even if only one source had failed.
- A user (or an e2e assertion) who had just supplied liquidity would see no confirmation that the on-chain position existed, purely because stream discovery was unavailable — nothing on the lending reads had actually failed.
- Flaky e2e run: the "Happy path — supply liquidity at a chosen rate" scenario intermittently failed to find the expected LIQUIDITY card after `supplyLiquidity()` completed because a STREAMS-path failure suppressed the whole list.
- The failure was specific to the `streams` source: `liquidity` and `loanBook` are plain contract reads with a different failure domain than discovery projection.

## What Didn't Work

No failed-and-reverted attempts were made here — the fix was scoped correctly on the first pass. One alternative was considered and deliberately scoped out rather than attempted:

- **Splitting `isLoading` the same way `hasError` was split.** The combined loading flag was left untouched as a conscious scope decision: the reported bug was in the *error* path, and inventing new partial-loading sub-states would add UI surface without a concrete reported problem motivating it.

## Solution

The single `hasError` flag was split into flags scoped to their actual failure domains, and every downstream boolean (`hasLending`, `hasBorrowing`, `hasStreams`, and the empty-state guard) was updated to check the matching flag instead of one shared one.

```ts
const onChainError = Boolean(liquidity.error || loanBook.error);
const streamsError = Boolean(streams.error);
// Render LENDING/BORROWING from on-chain reads even when STREAMS is unavailable.
```

`liquidity` / `loanBook` derive errors from wagmi contract reads. `useHeldStreams` derives unavailability from registry / projection outcomes (`web/hooks/useHeldStreams.ts`) — a different failure domain. Treating them as one error domain meant the less reliable or differently timed source could hide the success of the other.

The empty-return guard needed the identical treatment: an errored source with an empty derived array must not look like "the user genuinely has no positions."

This split stays consistent after the live cutover: LENDING/BORROWING and STREAMS can share an on-chain world and still fail independently (see CONCEPTS.md Position groups).

## Prevention

- **General rule**: when a component reads from N independent data sources that have different reliability/failure characteristics, gate loading/error/empty state per-source rather than combining them into one flag with `||`. A combined flag is only correct when a failure in any source genuinely invalidates the whole view.
- **Test pattern**: mirror the `"per-source error isolation"` describe block in `web/tests/components/position-cards.test.tsx` for any other component that combines multiple hook sources.
- **Code review heuristic**: grep for `||` chains that combine `.error` (or `.isLoading`) fields from multiple distinct hooks and check whether those hooks share a failure domain.

## Related Issues

- `docs/solutions/integration-issues/indexer-window-wall-clock-vs-chain-time.md` — a different bug (trailing time-window filter anchored to wall-clock time instead of chain time) with the same philosophy: map fetch errors to an honest unavailable state, not a fake empty result.
- `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md` — empty vs unavailable for stream discovery itself.
- `docs/solutions/integration-issues/live-discovery-cutover-must-keep-partial-stale-reads-fail-closed.md` — post-cutover fail-closed consumer rules.
