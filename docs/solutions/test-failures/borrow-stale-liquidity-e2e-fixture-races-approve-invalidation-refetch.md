---
title: "Borrow-form stale-liquidity E2E scenario races the approve-tx's own invalidateAllOnChainReads refetch"
date: 2026-07-28
category: test-failures
module: web/tests/e2e/steps/borrow.ts
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "web/tests/e2e/borrow.feature scenario \"Error state — stale liquidity triggers an automatic re-quote, not a dead end\" intermittently times out instead of passing"
  - "The BORROW button in BorrowForm (web/components/ActionModal.tsx) stays permanently disabled and is never clicked, so the borrow tx never submits and never reverts with the expected OVRFLOLending: liquidity inactive error"
  - "Debug tracing showed gatherIdsLen: 1 (a valid quote matching the fixture's posted liquidity) right after the APPROVE STREAM tx, then gatherIsFetching: true, then gatherIdsLen: 0 once the invalidation-triggered refetch resolved"
  - "selectedApr becomes null and fill becomes 0n once the ladder (useLendingLiquidity / resolveSelectedTick) reflects the already-withdrawn liquidity, cascading into the BorrowForm disabled boolean"
  - "Re-running the same scenario in isolation passed on some runs and timed out on others, consistent with a race rather than a deterministic defect"
root_cause: async_timing
resolution_type: test_fix
related_components:
  - "web/hooks/useStaleRecovery.ts"
  - "web/hooks/useWriteFlow.ts"
  - "web/lib/invalidate.ts"
  - "web/components/ActionModal.tsx"
  - "web/lib/borrow.ts"
  - "web/lib/errors.ts"
  - "web/tests/e2e/fixtures/chain.ts"
  - "src/OVRFLOLending.sol"
tags: [e2e, playwright, race-condition, stale-liquidity, wagmi, refetch, flaky-test, borrow]
---

# Borrow-form stale-liquidity E2E scenario races the approve-tx's own invalidateAllOnChainReads refetch

## Problem

The Playwright/Gherkin E2E scenario "Error state — stale liquidity triggers an automatic re-quote, not a dead end" in `web/tests/e2e/borrow.feature` is meant to exercise the stale-recovery UX in `web/hooks/useStaleRecovery.ts`: the BORROW form submits a borrow transaction against a quote that has gone stale (a lender withdrew their liquidity out from under it), the transaction reverts with `OVRFLOLending: liquidity inactive` (one of `STALE_LIQUIDITY_REASONS` in `web/lib/errors.ts:63-68`), `classifyBorrowError` (`web/lib/borrow.ts:58`) classifies the error kind as `"stale"`, and `useStaleRecovery` (`web/hooks/useStaleRecovery.ts:14-30`) shows a "LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM" banner plus a "RE-CONFIRM BORROW" affordance instead of a dead-end error.

Instead, the scenario intermittently timed out before that flow was ever reached.

## Symptoms

- The BORROW button in `BorrowForm` (`web/components/ActionModal.tsx:749` for the function; the button itself at `:1106-1124`, gated by `disabled={disabled || terminal}` on `:1109`) stayed permanently `disabled` and was never clicked successfully.
- The borrow transaction submission never happened, so the revert/classify/recover path was never exercised.
- Playwright's error showed the click retrying against a disabled button for the full 30s timeout — a stuck-precondition failure, not an assertion failure inside the flow under test.
- The failure was intermittent: the same scenario passed on some runs and timed out on others.

## What Didn't Work

The `disabled` computation in `BorrowForm` (`web/components/ActionModal.tsx:927-936`) is:

```ts
const disabled =
  !market.lending ||
  !selectedStreamId ||
  !recipientMatches ||
  target === 0n ||
  fill === 0n ||
  busy ||
  !quoteData ||
  minAcceptable === null ||
  gatherIds.length === 0;
```

The initial hypothesis space was: either (a) the disable is a genuinely correct reflection of current chain state — the view call legitimately finds no liquidity, meaning the scenario's premise (clicking a live BORROW button after the withdrawal) is unreachable and needs rearranging — or (b) some read is using stale cached data that should have refetched but didn't.

To distinguish these, temporary debug instrumentation was added: a `console.log` printing every sub-condition of `disabled` plus wagmi `useReadContract` fetch-status fields (`gather.status`, `gather.isFetching`, `fillQuote.status`) on every render of `BorrowForm`, forwarded from the browser console to the Playwright test's stdout via a temporary `page.on("console", ...)` handler added to the auto-fixture list in `web/tests/e2e/fixtures/fork-snapshot.ts`. Re-running the scenario with this instrumentation showed the actual sequence:

1. Right after "click APPROVE STREAM" (a real wagmi `useWriteContract` transaction) is submitted and while it's pending/confirming (`busy: true`), the debug trace showed `gatherIdsLen: 1`, `fill: '1000000000000000000'`, `selectedApr: 1000`, `quoteFetchStatus: 'success'` — a good, correct quote matching the liquidity the fixture had posted (via `lenderSupplyLiquidity` in the `Given "a lender has posted liquidity..."` step, `web/tests/e2e/steps/borrow.ts:21-30`).
2. `busy` flipped to `false` once the approve transaction confirmed — data was still correct (`gatherIdsLen: 1`).
3. `gatherIsFetching: true` then appeared. This is `useWriteFlow.ts`'s effect (`web/hooks/useWriteFlow.ts:27-33`, gated on `isConfirmed` — a derived flag requiring `receipt.data?.status === "success"`, not just `receipt.isSuccess`, per that file's own comment warning that a reverted tx still mines a receipt) firing `invalidateAllOnChainReads(queryClient, user)` (`web/lib/invalidate.ts:9-13`) once the APPROVE transaction's receipt confirmed successfully. `invalidateAllOnChainReads` invalidates every `readContract`/`readContracts` react-query key by prefix — a deliberately coarse post-write invalidation, per that function's own comment: "wagmi v3 roots useReadContract / useReadContracts keys at these string literals ... so prefix matching refetches every mounted on-chain read." This triggered background refetches of the ladder (`useLendingLiquidity`), `gather` (`gatherLiquidity` view call), and `fillQuote`/`fullQuote` (`quote` view call) reads.
4. That refetch resolved to `gatherIdsLen: 0` (gather's args — market, selectedApr, fill — were unchanged, so this was the *same* query key genuinely refetching, not a stale-cache bug), then a tick later the ladder read also reflected zero liquidity at any rate, so `resolveSelectedTick` (`web/lib/borrow.ts:17`) returned `null` for `selectedApr`, `fill` collapsed to `0n`, and the `disabled` boolean flipped permanently `true`. The BORROW button was never clickable again for the rest of the scenario.

This ruled out both original hypotheses as stated. It is not that a read failed to refetch when it should have — react-query's `staleTime: 10_000` config (`web/lib/wagmi.ts:73-80`) means nothing auto-refetches without either an explicit invalidation or a page reload, and here an explicit invalidation *did* fire, correctly, as designed. And it is not simply "the disable is a legitimate, permanent reflection of reality" either — the disable was only *accidentally* correct, because of exactly when it happened relative to two unsynchronized async actors.

**(session history)** This gap traces back to the scenario's original design. When `useStaleRecovery` and this exact AE5 scenario were first built, the design session explicitly reasoned that Playwright's own actionability auto-waiting would be sufficient synchronization for the suite's approve→submit sequencing in general ("the button stays disabled via the `busy` flag until approval completes — Playwright's auto-waiting handles this naturally without needing manual waits"). That assumption holds for sequencing *within* the browser's own click stream, but was never revisited for the specific case of an out-of-band fixture chain-write (`withdrawLiquidity`, run via a direct viem call from the lender persona, bypassing the UI) injected concurrently with the app's own post-approve invalidation cycle — which is exactly the gap this race exploited. A structurally identical assumption was made for the `Given "the stream has already been claimed elsewhere"` step inside `claim-all.feature`'s "Error state — a contract revert fails the queue mid-flight" scenario, in the same design pass (draining a stream out-of-band via the `claimStreamMax` fixture helper, which calls Sablier's `withdrawMax` as `devClient`, before the queue's confirmation click) — worth auditing if a similar intermittent failure ever shows up there.

A first attempt at fixing the broader E2E flakiness in this suite (a shared "the frontend re-syncs with chain state" reload step, plus a Ponder-visibility wait helper `waitForHeldStream`) resolved a different, broader class of flake — streams not yet visible after creation — but explicitly did not resolve this scenario, which needed its own targeted fix.

## Root Cause

A race between two independent, unsynchronized async actors:

- **Actor A**: the app's own `invalidateAllOnChainReads`, which `useWriteFlow.ts` (`web/hooks/useWriteFlow.ts:27-33`) fires automatically once the APPROVE transaction's `isConfirmed` flag flips true — a real confirmation-polling round trip (wagmi's `useWaitForTransactionReceipt` polling, then the invalidation effect, then new `eth_call`s for the invalidated reads).
- **Actor B**: `web/tests/e2e/steps/borrow.ts`'s `When("the posted liquidity is withdrawn by the lender", ...)` step, which called `withdrawLiquidity()` — a direct viem call from the *lender* persona (`web/tests/e2e/fixtures/chain.ts`; bypasses the UI entirely, since the E2E mock connector only ever signs as one address, the dev wallet, per that file's own top-of-file comment on why fixture-direct arrangement exists for lender-side state) — immediately after the "click APPROVE STREAM" Playwright step returned, with zero synchronization on Actor A's progress.

Because Actor B's on-chain transaction (direct viem `writeContract` + `waitForTransactionReceipt`, no UI round trip) is typically faster than Actor A's full poll-then-invalidate-then-refetch cycle, the withdrawal frequently landed on-chain before Actor A's refetch resolved. `gatherLiquidity` (`src/OVRFLOLending.sol:698-731`, a `view` function) is written to return empty `ids` and `sufficient: false` rather than revert when no matching liquidity exists — the early-return path handles the empty-scan-range case, and the main loop simply accumulates zero matches when no `LiquidityPosition` satisfies `liquidity.availableLiquidity > 0 && liquidity.market == market && liquidity.aprBps == aprBps && liquidity.lender != borrower`. So the live `eth_call` Actor A's refetch made after the withdrawal landed genuinely, correctly returned empty. The disabled gate in `ActionModal.tsx` was behaving exactly as designed given the data it had; the defect was that the test let an *incidental* background read (Actor A's routine post-approve invalidation, which has nothing conceptually to do with the withdrawal) discover the staleness first, instead of letting the scenario's actual target — the BORROW transaction submission itself reverting with `OVRFLOLending: liquidity inactive` (thrown by the `require` guards at `src/OVRFLOLending.sol:336`, `356`, `542`, and `748`) — discover it.

## Solution

Fixed entirely in `web/tests/e2e/steps/borrow.ts`, in the working tree (not yet merged). Before (racy):

```ts
When("the posted liquidity is withdrawn by the lender", async () => {
  const deployment = readDeployment();
  if (liquidityId === null) throw new Error("no liquidity arranged yet — call the supply Given step first");
  await withdrawLiquidity({ lending: deployment.lending, liquidityId });
});
```

After (synchronized), currently at `web/tests/e2e/steps/borrow.ts:58-63`:

```ts
When("the posted liquidity is withdrawn by the lender", async ({ page }) => {
  const deployment = readDeployment();
  if (liquidityId === null) throw new Error("no liquidity arranged yet — call the supply Given step first");
  await expect(page.getByRole("dialog").getByRole("button", { name: "BORROW", exact: true }).first()).toBeEnabled();
  await withdrawLiquidity({ lending: deployment.lending, liquidityId });
});
```

`import { expect } from "@playwright/test";` was also added at the top of the file (`web/tests/e2e/steps/borrow.ts:1`), and an explanatory comment above the step (`web/tests/e2e/steps/borrow.ts:44-57`) documents the race for future readers.

## Why This Works

Waiting for the BORROW button to be enabled is a proxy for "Actor A's post-approve invalidation-triggered refetch has already settled with a fresh, pre-withdrawal quote." Once that condition holds, nothing else in the app triggers a further automatic refetch — per the global `staleTime: 10_000` in `web/lib/wagmi.ts:76` and the absence of any block-watching or polling elsewhere in this read path — so the withdrawal can now safely land afterward: the client keeps holding its cached quote (accurate at fetch time, now real-world-stale), the user clicks BORROW, the transaction submits and reverts with `OVRFLOLending: liquidity inactive`, `classifyBorrowError` classifies it as `"stale"`, and `useStaleRecovery` (`web/hooks/useStaleRecovery.ts:23-27`) fires its own `invalidateAllOnChainReads` and shows the expected re-confirm banner.

This is the same synchronization role a page reload (`Given "the frontend re-syncs with chain state"`, in `web/tests/e2e/steps/common.ts`) plays for other fixture-direct arrangement steps in this suite — but a reload can't be used here because it would drop the open modal, and the whole point of this scenario is to exercise the stale-recovery UX with the modal still open. Ordering the withdrawal after an observable UI signal (button becomes enabled) instead of after an unrelated Playwright step's completion removes the race entirely: it doesn't matter how long Actor A's poll-then-invalidate-then-refetch cycle takes, because Actor B now waits for it to finish before acting.

Verification: the target scenario passed on 3 consecutive runs (previously intermittent), and the full `borrow.feature.spec.js` suite (6 scenarios) passed with no regressions. The temporary debug instrumentation (the `console.log` in `ActionModal.tsx` and the console-forwarding fixture in `web/tests/e2e/fixtures/fork-snapshot.ts`) was fully removed before finalizing — confirmed via a clean `git diff --stat` on both files. The final diff is isolated to `web/tests/e2e/steps/borrow.ts`.

## Prevention

- E2E fixture-direct arrangement steps that inject out-of-band chain mutations between two app-observable UI actions must synchronize on an observable UI signal — a button becoming enabled/disabled, specific text appearing, a `data-testid` state change — representing "the app's own async effects from the prior action have settled," not just fire-and-forget immediately after a Playwright click resolves. A Playwright step resolving only means the *initiating* action (e.g., a click that fires a wagmi write) has returned; it says nothing about whichever async chain reaction that action kicks off client-side (transaction confirmation polling, post-write invalidation, background refetches).
- This matters most when the prior action is itself a real wagmi write whose confirmation triggers automatic query invalidation (as `useWriteFlow.ts`'s `invalidateAllOnChainReads` does here): any fixture-direct chain mutation injected in the following step is racing that invalidation's refetch, and whichever one resolves first — the app's own routine background refetch, or the scenario's deliberately staged mutation — determines which code path the test actually exercises.
- Playwright's default actionability auto-waiting is not a substitute for this: it only guarantees the element you're about to interact with is visible/stable/enabled at click time, not that the app has finished reacting to an *unrelated* prior write. Relying on it for approve→submit sequencing within one click stream is fine; relying on it to order a concurrent out-of-band fixture write is the specific gap this bug closed.
- `web/tests/e2e/steps/claim-all.ts` uses the same out-of-band-persona pattern (draining a stream via `claimStreamMax`, a direct viem call as the `devClient` persona, bypassing the UI) for the `Given "the stream has already been claimed elsewhere"` step inside `claim-all.feature`'s "contract revert fails the queue mid-flight" scenario. That step relies on the same "Playwright auto-wait is enough" assumption that caused this bug — audit it for the same class of intermittent failure if it ever starts flaking.
- When a scenario's whole purpose is to make a specific stale-data path fire (e.g., a submit-time revert), pin the injected mutation to land strictly after the app has already re-settled on a fresh read, using the same UI-visible condition the app itself would use to indicate "I'm caught up" — never a race against an unrelated in-flight async effect.
- If diagnosing a similarly racy E2E failure by spawning a separate diagnosis session, avoid running it concurrently with another Playwright suite against the same shared local Anvil fork: two workers calling `evm_snapshot`/`evm_revert` against one fork can collide, corrupting fork state for both (`forkSnapshot`'s auto-fixture in `web/tests/e2e/fixtures/fork-snapshot.ts` throws `evm_revert(...) returned false` when this happens). Re-running `tools/scripts/bootstrap-e2e.sh` clears it, but it's cheaper to just not run two suites against the fork at once.

## Related Issues

- `docs/solutions/test-failures/createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md` — a related but mechanistically distinct `async_timing` E2E race in the same borrow/lending e2e surface: that one is a wall-clock gap between reading a quote and mining a transaction (fixed with gas padding + `receipt.status` checks in an ARRANGE fixture helper), not a query-invalidation-vs-fixture-write race in a WHEN step. Same general "account for real wall-clock drift in e2e arrange helpers" lesson, worth cross-referencing, not a duplicate.
- `docs/solutions/logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md` — a related "mined-but-reverted transaction treated as confirmed" bug in `useTxQueue.ts` (branching on `receipt.isSuccess` instead of `receipt.data.status`). Different bug, same neighborhood of code (`useWriteFlow.ts`'s confirmation-handling siblings) — that doc's own Prevention section already flags `useWriteFlow.ts` as worth auditing for the same class of gap.
- `docs/solutions/logic-errors/adjust-rate-multicall-shrink-race.md` — documents the shared classify-as-stale / invalidate-and-re-confirm UI pattern (`useStaleRecovery`-style) this scenario exercises, including the "RE-CONFIRM" UX. Useful background on the recovery UI being tested; its own bug is unrelated to this test-timing race.
- `docs/solutions/architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md` — establishes the shared-Anvil-fork, serial-worker execution model every borrow/lending e2e scenario runs under, including the snapshot-collision hazard noted above.
- `web/tests/e2e/README.md` documents the "the frontend re-syncs with chain state" full-page-reload technique as the way to make fixture-direct writes visible to the app. This fix establishes a second, narrower technique — wait for a UI proxy signal instead of reloading — for scenarios that need the app's own stale-read handling exercised rather than papered over by a reload.
