---
title: "Unwrap row-gate compared wrap reserve to entire wallet balance instead of the intended unwrap amount"
date: 2026-07-28
category: ui-bugs
module: Web UI
problem_type: ui_bug
component: nextjs_react
severity: medium
symptoms:
  - "UNWRAP button stayed disabled with caption \"WRAP RESERVE EMPTY\" despite a confirmed on-chain wrap() transaction leaving a nonzero wrap reserve"
  - "Disabled state persisted after a confirmed deposit() transaction minted additional ovrfloToken to the same wallet"
  - "Disabled state persisted after a full page reload that forced a refetch of on-chain state"
  - "The gate was permanently stuck, not a transient flicker, across the full Playwright retry window"
root_cause: logic_error
resolution_type: code_fix
related_components: [web/components/MarketRowDetail.tsx, web/components/ActionModal.tsx]
tags: [wrap-reserve, unwrap, market-row-detail, action-modal, wagmi, ui-gating, e2e]
---

# Unwrap row-gate compared wrap reserve to entire wallet balance instead of the intended unwrap amount

## Problem

`MarketRowDetail`'s UNWRAP button disabled itself whenever the vault's wrap reserve was smaller than the connected wallet's *entire* ovrfloToken balance, instead of only when the reserve was actually empty — so any wallet holding more ovrfloToken than the currently available reserve (the ordinary case whenever deposit-origin and wrap-origin balances diverge) was locked out of a perfectly valid partial unwrap.

## Symptoms

- The Playwright/Gherkin scenario "Happy path — unwrap ovrfloToken back into underlying" (`web/tests/e2e/deposit-wrap-unwrap.feature:61-70`) failed: the UNWRAP button never became clickable.
- The row showed the caption "WRAP RESERVE EMPTY" even though the wrap reserve was non-zero (1 unit, arranged by the scenario's `Given the wrap reserve holds "1"` step) — a misleading caption, since the reserve was not empty.
- The wrong state was sustained, not a load-timing flicker: a 30-second Playwright retry/poll loop against the button's enabled state never resolved, meaning the underlying React state itself was wrong, not merely slow to arrive.
- The condition reproduced deterministically whenever the same wallet held a wrap reserve smaller than its total ovrfloToken balance — in this scenario, reserve = 1 (from `wrapUnderlying`) vs. wallet balance = 10 (from `depositPtForStream`), i.e. exactly the "partial capacity" arrangement the scenario sets up.

## What Didn't Work

Three simpler explanations were checked and ruled out before finding the actual bug, each with concrete evidence:

- **On-chain tx failure.** Both arrangement steps in `web/tests/e2e/steps/deposit-wrap-unwrap.ts` — `Given("the wrap reserve holds {string}", ...)` (line 29) calling `wrapUnderlying()`, and `Given("my wallet holds ovrfloToken from a deposit of {string}", ...)` (line 16) calling `depositPtForStream()` — route through `mineAndGetReceipt()` in `web/tests/e2e/fixtures/chain.ts` (lines 142-148), which explicitly throws if the transaction receipt status isn't `"success"`. Since neither step threw, both the wrap and the deposit were confirmed to have succeeded on-chain exactly as arranged. This ruled out "the reserve was never actually set" as the cause.
- **Frontend not re-syncing after fixture-driven state changes.** `web/tests/e2e/steps/common.ts`'s `Given("the frontend re-syncs with chain state", ...)` step does a full `page.reload()` specifically because fixtures mutate chain state directly, bypassing the app's own cache invalidation. This exact reload pattern had already been needed and had already fixed analogous staleness bugs earlier in the same session across `borrow.feature`, `claim-all.feature`, `adjust-rate.feature`, and `repay-close.feature`. Since the scenario already included this reload step (`deposit-wrap-unwrap.feature:64`) and the bug persisted anyway, a stale-query-cache explanation was ruled out for this scenario specifically — if this were a freshness problem, the reload (which fixed it everywhere else) would have fixed it here too.
- Combined, these two rule-outs meant: the on-chain state was correct, and the frontend had genuinely refetched it after a full reload — yet the UI still showed the wrong disabled/caption state. That combination pointed straight at the frontend's own comparison/gating logic being wrong, not a data-freshness or transaction-correctness problem.
- **(session history)** The buggy comparison was not a fresh mistake made while writing this scenario — the row-level "wrap-reserve short" disable condition traces back to ticket 10's edge-state sweep (`.scratch/web-ux-v1/issues/10-edge-state-sweep-and-gates.md`, resolved 2026-07-27, checklist item "wrap-reserve short ✓"), which deliberately added this as one of several previously-unhandled empty/edge states. Separately, session history from a later debugging session on 2026-07-28 shows an auto-spawned background task reacting to a "wrap reserve shows empty" symptom by making a change described only as "simplified the disabled condition" to this same file, which the orchestrating session accepted on the strength of the test suite passing rather than by reviewing the actual diff. That spawned task's own transcript wasn't available to confirm the exact before/after it applied, so this is offered as probable context rather than a verified causal chain — but it lines up with how an unreviewed one-line "simplification" could plausibly have introduced (or reintroduced) exactly this kind of comparison-against-the-wrong-quantity bug.

## Solution

The bug was in `web/components/MarketRowDetail.tsx`. The component reads the vault's wrap-reserve accounting via `useReadContract` on `wrappedUnderlying()` (lines 55-59):

```ts
const wrappedUnderlying = useReadContract({
  address: market.vault,
  abi: ovrfloAbi,
  functionName: "wrappedUnderlying",
});
```

and derives `wrapCapacity` from it (line 67):

```ts
const wrapCapacity = wrappedUnderlying.data ?? 0n;
```

The read itself was correct — `wrappedUnderlying()` is the right source per `CONCEPTS.md`'s "Wrap reserve" entry ("the tracked amount of underlying asset that backs the unwrap path... direct token transfers or donations to the vault do not increase the wrap reserve," `CONCEPTS.md:67-71`). The bug was in what `wrapCapacity` got compared against, at line 68:

Before:
```ts
const wrapReserveShort = wrapCapacity === 0n || wrapCapacity < ovrfloBal;
```

After (current state of the file):
```ts
const wrapReserveShort = wrapCapacity === 0n;
```

`ovrfloBal` (from `balanceReads` at lines 45-53/64) is the connected wallet's *total* ovrfloToken balance across all origins (deposit and wrap alike) — not the amount the user is attempting to unwrap. Comparing the vault-wide reserve against the wallet's entire balance meant the button went disabled the instant reserve fell short of covering every token the user owned, regardless of how small an amount they actually intended to unwrap. The disabled prop at line 121, `disabled={ovrfloBal === 0n || wrapReserveShort}`, is untouched by the fix and still independently disables the button when the wallet holds no ovrfloToken at all, so no coverage was lost — only the incorrect additional constraint was removed.

The correct, contrasting pattern already existed one file over, in `web/components/ActionModal.tsx`. It reads the same `wrappedUnderlying()` value into its own `wrapCapacity` (lines 567-571, 600):

```ts
const wrappedUnderlying = useReadContract({
  address: market.vault,
  abi: ovrfloAbi,
  functionName: "wrappedUnderlying",
});
...
const wrapCapacity = wrappedUnderlying.data ?? 0n;
```

and gates the modal's submit button on the *actual typed amount*, not the wallet's total holdings (line 618):

```ts
const modeDisabled =
  disabled ||
  Boolean(validationError) ||
  (mode === "deposit" && (!depositPreview || matured || !capLoaded || capReached)) ||
  (mode === "claim_matured" && !matured) ||
  (mode === "unwrap" && wrapCapacity < amount);
```

It also surfaces the same number to the user directly, at line 647: `` UNWRAP CAPACITY {formatTokenAmount(wrapCapacity, underlyingSymbol)} ``. This per-transaction check was already correct and was left untouched by the fix.

## Why This Works

`MarketRowDetail`'s row-level gate and `ActionModal`'s per-transaction gate are answering two different questions, and the bug came from collapsing them into one comparison:

- **Row-level question** ("is unwrapping even worth offering right now?"): is there *any* reserve at all? `wrapCapacity === 0n` answers this correctly — if the reserve is completely empty, there is nothing to unwrap against, so the row should say so and disable the entry point.
- **Modal-level question** ("can THIS specific transaction go through?"): does the reserve cover the amount the user actually typed? `wrapCapacity < amount` (`ActionModal.tsx`) answers this correctly, because `amount` is bounded by whatever the user enters in the form — never more than they intend to unwrap in that transaction.

`wrapCapacity < ovrfloBal` conflated the two: it asked "does the reserve cover the user's *entire* wallet balance," which is a strictly harder bar to clear than "is the reserve non-zero," and unrelated to "does the reserve cover what they're about to submit." Under the vault's fungible ovrfloToken model, a wallet routinely accumulates ovrfloToken from multiple origins — deposits (which mint against Sablier streams) and wraps (which mint 1:1 against the tracked wrap reserve) are fungible by design (see `CONCEPTS.md`'s "Wrap reserve" entry and the codebase's broader cross-market ovrfloToken fungibility stance). A wallet with 10 ovrfloToken from a deposit and only 1 unit of wrap reserve behind it is not a degenerate edge case — it is the *typical* state, since deposit volume and wrap volume are independent quantities with no reason to move in lockstep. Gating the row on "reserve covers my whole balance" effectively disabled UNWRAP for the common case and only ever enabled it in the narrow case where reserve happened to meet or exceed total holdings.

## Prevention

- **When two components read the same on-chain value via the same `functionName`, check their derived logic against each other.** Both `MarketRowDetail.tsx` and `ActionModal.tsx` call `useReadContract` with `functionName: "wrappedUnderlying"` on the same vault address (wagmi dedupes the actual network request by query key), but each component built its own comparison independently, and only one of the two got it right. When touching a shared on-chain read, grep the codebase for the same `functionName` string across components and confirm every consumer's disable/validation logic agrees on what the value is being compared against.
- **A capacity/reserve check should almost always compare against "the amount being transacted," not "the total holdings of the actor,"** unless the check is genuinely meant to answer a total-zero-availability question (e.g., "should this control even be shown/enabled at all"). If a check names a specific quantity (`wrapCapacity`) but compares it to something broader in scope (`ovrfloBal`, the whole wallet), that scope mismatch is worth a second look — it's a classic source of this exact class of bug.
- **Write E2E scenarios that arrange a reserve/capacity smaller than the actor's total balance.** `deposit-wrap-unwrap.feature`'s unwrap scenario already does this deliberately (wrap reserve = 1, wallet ovrfloToken balance = 10), and that's precisely the gap that exposed the bug — a scenario where reserve happens to equal or exceed the wallet's whole balance would have passed against either version of the code and never caught it.
- **(session history)** Treat an auto-spawned or background-agent fix as a diff to review, not a green checkmark to trust. A prior session accepted a background task's one-line "simplified the disabled condition" change to this exact file solely because the test suite passed afterward, without reading the actual diff — which is a plausible way this bug entered or re-entered the code in the first place. A passing suite confirms the scenarios it covers; it does not confirm the change matches the intended semantics, especially for a one-line boolean condition where a subtly wrong comparison and a correct one can both pass a suite that doesn't happen to include a partial-capacity scenario.
- One-line footnote on a tooling quirk hit while verifying this fix: running `npx bddgen` as a separate command before `npx playwright test tests/e2e/<spec>.spec.js` throws `Error: Playwright Test did not expect test.beforeEach() to be called here`. Neither `web/tests/e2e/fixtures/bdd.ts` nor `fork-snapshot.ts` contains any `test.beforeEach()` call — that call is generated by `playwright-bdd` itself into its gitignored generated-test output directory (derived from a feature's `Background:` block), and a standalone `bddgen` invocation collides with the generation `playwright.config.ts`'s `defineBddConfig(...)` already triggers automatically during Playwright's own config resolution. Skip the manual `bddgen` step and just run `NEXT_PUBLIC_E2E=1 npx playwright test tests/e2e/<spec>.spec.js -g "<scenario>"` directly.

## Related Issues

- `docs/solutions/ui-bugs/positionlist-blanket-error-hides-onchain-positions.md` — a different bug in a different component (`PositionList.tsx`'s flattened per-source error booleans hiding valid positions), but the same antipattern family: a component derived/compared on-chain-sourced state incorrectly when gating what the user could see or do. Both distill to the same prevention theme — gate UI state on the correctly scoped quantity, not a coarser or wrong one.
- `docs/solutions/architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md` — touches this exact same `wrapCapacity`/`wrappedUnderlying` read in `MarketRowDetail.tsx` and its `ConvertForm`/`ActionModal.tsx` cross-reference, but for a different concern (whether the read is safe to batch into a `useReadContracts` call given its `enabled` gate). Useful forward reference for anyone touching this same read again.
- `docs/solutions/architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md` — the Solidity-side contract doc for the `wrappedUnderlying` reserve invariant this bug's `wrapCapacity` value is read from (unwrap capacity must come from the tracked counter, never raw `balanceOf`). Different layer and track (contract invariants vs. this frontend consumer bug), but the source of truth for what `wrapCapacity` is supposed to mean.
- `.scratch/web-ux-v1/issues/10-edge-state-sweep-and-gates.md` — the original ticket (resolved 2026-07-27) whose edge-state sweep first added a "wrap-reserve short" disable treatment to this row; the historical origin point for this code path.
