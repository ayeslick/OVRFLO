---
title: "Blanket hasError flag hid on-chain LENDING/BORROWING positions when only the Ponder indexer failed"
category: ui-bugs
module: Web UI
date: 2026-07-28
problem_type: ui_bug
component: nextjs_react
symptoms:
  - "Playwright e2e 'Happy path' supply test flakes: a LIQUIDITY position just created on-chain by supplyLiquidity() is invisible after the transaction confirms"
  - "Entire PositionList is replaced by a blanket 'UNABLE TO LOAD POSITIONS' message whenever any one of three independent data sources errors"
  - "A slow or not-yet-backfilled Ponder indexer hides successfully-created LENDING/BORROWING positions that came from unrelated on-chain reads"
  - "No way to distinguish an on-chain RPC read failure from an off-chain indexer (Ponder) failure in the rendered UI"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [position-list, ponder, error-handling, error-isolation, indexer, wagmi, e2e-flake]
---

# Blanket hasError flag hid on-chain LENDING/BORROWING positions when only the Ponder indexer failed

## Problem

`PositionList` (`web/components/PositionList.tsx`) collapsed the error states of three independent data sources into a single `hasError` flag, so when the Ponder indexer failed while the on-chain reads succeeded, the entire position list — including positions that had just been created on-chain — was replaced with one blanket "UNABLE TO LOAD POSITIONS" message.

## Symptoms

- `PositionList` rendered `UNABLE TO LOAD POSITIONS` and hid all LENDING, BORROWING, and STREAMS groups whenever *any* of `liquidity.error`, `loanBook.error`, or `streams.error` was truthy, even if only one source had failed.
- A user (or an e2e assertion) who had just supplied liquidity would see no confirmation that the on-chain position existed, purely because the separate Ponder indexer was slow or down — nothing on-chain had actually failed.
- Flaky e2e run: the "Happy path — supply liquidity at a chosen rate" scenario (`web/tests/e2e/supply.feature`, driven by `web/tests/e2e/steps/supply.ts` and the shared step definitions in `web/tests/e2e/steps/common.ts`) intermittently failed to find the expected LIQUIDITY card after `supplyLiquidity()` completed. Root cause: on a freshly seeded local Anvil fork (`BOOT_NO_UI=1 npm --prefix web run bootstrap:local`, see `web/tests/e2e/README.md`), Ponder can still be backfilling or not yet reachable at `NEXT_PUBLIC_PONDER_URL` when the test asserts the position card, which sets `streams.error` in `useHeldStreams` (`web/hooks/useHeldStreams.ts:41-45`) and, before the fix, suppressed the whole list.
- The failure was specific to the `streams` source: `liquidity` (`web/hooks/useLendingLiquidity.ts`) and `loanBook` (`web/hooks/useLoanBook.ts`) are plain `useReadContracts` calls against the chain with no dependency on Ponder, so they were reliably succeeding at the exact moment the combined flag was hiding their results.

## What Didn't Work

No failed-and-reverted attempts were made here — the fix was scoped correctly on the first pass. One alternative was considered and deliberately scoped out rather than attempted:

- **Splitting `isLoading` the same way `hasError` was split.** The combined `isLoading = liquidity.isLoading || loanBook.isLoading || streams.isLoading` (`web/components/PositionList.tsx:62`) was left untouched. This was a conscious scope decision, not an oversight, for two reasons: (1) the reported and reproduced bug was specifically in the *error* path — a slow/unreachable Ponder instance ultimately surfaces as `streams.error`, not an indefinite loading hang, so there was no concrete failure to fix; (2) inventing new partial-loading sub-states (e.g. separate "LOADING LENDING POSITIONS" / "LOADING STREAMS" placeholders) would add new UI surface area that would need to clear this project's pixel-level DESIGN.md QA process (see the manual QA checklist added in `2a6540a docs(web): add manual QA checklist for pixel-level DESIGN.md compliance (ticket 06)`) without a concrete reported problem motivating it. This tradeoff is not recorded in a code comment — only in this writeup — since it's a scope decision about what *wasn't* changed, not behavior the reader needs explained at the call site.

## Solution

The single `hasError` flag was split into two flags scoped to their actual failure domains, and every downstream boolean (`hasLending`, `hasBorrowing`, `hasStreams`, and the empty-state guard) was updated to check the matching flag instead of one shared one.

Before (conceptually — the shape of the code prior to this change):

```ts
const hasError = liquidity.error || loanBook.error || streams.error;

if (hasError) {
  return (
    <div className="empty mono status-negative">
      UNABLE TO LOAD POSITIONS
    </div>
  );
}
```

After, current code at `web/components/PositionList.tsx:64-104`:

```ts
// liquidity + loanBook are plain on-chain reads; streams comes from the
// Ponder indexer (lib/ponder.ts) and can error independently — each source
// degrades on its own so an indexer hiccup can't hide on-chain positions
// (e.g. a just-created LIQUIDITY position) behind a blanket error message.
const onChainError = Boolean(liquidity.error || loanBook.error);
const streamsError = Boolean(streams.error);

...

// Each group only reports positions when its own source is error-free —
// an indexer error must not read as "no positions" any more than it should
// read as "no on-chain positions either."
const hasLending = !onChainError && (userLiquidity.length > 0 || userPools.length > 0);
const hasBorrowing = !onChainError && userLoans.length > 0;
const hasStreams = !streamsError && eligibleStreams.length > 0;

if (!onChainError && !streamsError && !hasLending && !hasBorrowing && !hasStreams) {
  return null;
}
```

And the JSX (`web/components/PositionList.tsx:106-213`) now renders each group's own error message in place of just that group, instead of one message replacing everything:

```tsx
{onChainError ? (
  <div className="position-group">
    <div className="empty mono status-negative">UNABLE TO LOAD LENDING POSITIONS</div>
  </div>
) : (
  <>
    {hasLending ? ( ...LENDING cards... ) : null}
    {hasBorrowing ? ( ...BORROWING cards... ) : null}
  </>
)}

{streamsError ? (
  <div className="position-group">
    <div className="label mono">STREAMS</div>
    <div className="empty mono status-negative">UNABLE TO LOAD STREAMS</div>
  </div>
) : hasStreams ? (
  ...STREAMS cards...
) : null}
```

Note `isLoading` itself was intentionally left as a single combined flag (`web/components/PositionList.tsx:62`, checked at `:71-73`) — see "What Didn't Work" above.

Test coverage: `web/tests/components/position-cards.test.tsx` — the file already covering `PositionList` (no separate `PositionList.test.tsx` exists in this repo). Added per-hook error mocking (`hookData.liquidityError`, `hookData.loanBookError`, `hookData.streamsError`, previously hardcoded to `error: null`) and a new `describe("per-source error isolation", ...)` block at `web/tests/components/position-cards.test.tsx:231-256` with 3 tests: LIQUIDITY still renders when only `streams.error` is set, STREAMS still renders when only `liquidity.error` is set, and both scoped error messages render when both sources fail. `npx vitest run` → 309 passed across 37 files, no regressions.

## Why This Works

`liquidity`/`loanBook` and `streams` are structurally different data sources with different failure domains. `useLendingLiquidity` (`web/hooks/useLendingLiquidity.ts:49-54`) and `useLoanBook` (`web/hooks/useLoanBook.ts:149-155`) both derive `error` purely from wagmi's `useReadContracts` against the chain (`lendingState.error ?? reads.error`) — no external service involved. `useHeldStreams` (`web/hooks/useHeldStreams.ts:41-45`) derives `error` from `discovery.error ?? sablierReads.error`, where `discovery` is a `useQuery` wrapping `fetchHeldStreamIds` from `web/lib/ponder.ts:62` — a call to the separate Ponder indexer service, which has its own uptime and backfill-lag characteristics independent of chain state.

Treating these as one error domain meant the less reliable source (an external indexer that can be down or still backfilling) could hide the success of the more reliable source (direct RPC reads that had just confirmed a real on-chain position). Splitting the flags restores the correct dependency: LENDING/BORROWING only fail when the on-chain reads actually failed, and STREAMS only fails when Ponder actually failed — each section degrades independently and reflects only its own source's health.

The empty-return guard needed the identical treatment for the same reason: without `!onChainError && !streamsError` in the guard at `web/components/PositionList.tsx:102`, an errored source with an empty derived array (e.g. `userLiquidity.length === 0` because the failed read never populated it) would look indistinguishable from "the user genuinely has no positions," silently swallowing the error as a false empty state instead of surfacing it.

This split is also consistent with a design decision already made elsewhere in this codebase: the borrow-demand ladder (also Ponder-backed) was earlier changed to distinguish "no data source" from "empty/zero result" rather than folding the two together, so that a missing data source reads as "NO DEMAND DATA" instead of a misleading real-zero state (source: session history, 2026-07-25 UX plan review). The `onChainError`/`streamsError` split applies the same philosophy — don't let an unavailable data source masquerade as a semantically different empty state — to error handling in `PositionList` specifically.

## Prevention

- **General rule**: when a component reads from N independent data sources that have different reliability/failure characteristics (on-chain RPC via wagmi vs. an indexer/API service, or any two sources that can fail independently of each other), gate loading/error/empty state per-source rather than combining them into one flag with `||`. A combined flag is only correct when a failure in any source genuinely invalidates the whole view — that's rarely true when one source is "ground truth" (the chain) and another is a derived/cached service (an indexer) that can legitimately be behind or briefly unavailable while the chain is fine.
- **This antipattern was already present elsewhere in the same component family**: the `useLoanBook` hook consolidates two on-chain sources (former `useLenderPools` + `useBorrowerLoans`) and still combines their status with `||` (e.g. `tooLarge`, `isLoading`) — that's fine there because both halves share the same failure domain (plain wagmi reads), but it's the same OR-flattening code shape that, when one of the ORed sources is Ponder instead of another wagmi read, produces this bug (source: session history, 2026-07-27 hook-consolidation session). When reviewing or extending `PositionList`/`PositionSummary`, check whether a newly-added source shares its failure domain with the sources it's being ORed against before reusing that shape.
- **Test pattern to replicate**: mirror the `"per-source error isolation"` describe block added in `web/tests/components/position-cards.test.tsx:231-256` (3 tests) for any other component that combines multiple hook sources: (1) error only the "less reliable" source and assert the "more reliable" source's content still renders alongside a scoped error message, (2) error only the "more reliable" source and assert the reverse, (3) error both and assert both scoped messages render. This requires per-hook error mocking (see `hookData.liquidityError` / `hookData.loanBookError` / `hookData.streamsError` in the same file, reset in `beforeEach`) rather than one shared mock error value.
- **Code review heuristic**: grep for `||` chains that combine `.error` (or `.isLoading`) fields pulled from multiple distinct hooks — e.g. `rg '\.error \|\| .*\.error' web/components web/hooks` — and check whether the underlying hooks share a failure domain (all plain RPC reads) or span domains (RPC + external indexer/API). If they span domains, that combined flag is a candidate for the same split done here.

## Related Issues

- `docs/solutions/integration-issues/indexer-window-wall-clock-vs-chain-time.md` — a different bug (a trailing time-window filter anchored to wall-clock time instead of chain time, hiding real borrow-demand data on the local fork) in a different hook, but the same underlying theme: Ponder-indexed data can silently look wrong or unavailable on a local fork in ways that a combined/flattened state check obscures. Its prevention rule ("map fetch errors to an honest unavailable state, not a fake empty result") is the same philosophy as this fix's per-source error isolation.
