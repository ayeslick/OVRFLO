---
title: createBorrowerLoanPool gas-estimation race flakes the repay-close e2e suite
date: 2026-07-28
last_refreshed: 2026-07-28
category: test-failures
module: web/tests/e2e/fixtures/chain.ts
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "web/tests/e2e/repay-close.feature.spec.js intermittently (about 30% of runs) throws \"createBorrowerLoanPool receipt did not contain a BorrowerLoanPoolCreated event\", with the failing scenario index moving around run to run rather than always the same ordinal"
  - "mineAndGetReceipt() in chain.ts never threw even though the underlying transaction had reverted, because it returned publicClient.waitForTransactionReceipt(...) directly without checking receipt.status"
  - "`cast run <hash>` on the reverted transaction showed the full createBorrowerLoanPool body executing successfully, including emitting BorrowerLoanPoolCreated, before failing with ReentrancySentryOOG — an out-of-gas revert at the nonReentrant guard's exit SSTORE"
  - "Re-running the single failing scenario in isolation after a fresh Anvil reseed passed every time, ruling out cross-scenario ordering or leftover chain state as the cause"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - OVRFLOLending
  - web/tests/e2e/fixtures/fork-snapshot.ts
tags: [anvil, viem, gas-estimation, e2e, playwright, flaky-test, reentrancy-guard, race-condition]
---

# createBorrowerLoanPool gas-estimation race flakes the repay-close e2e suite

## Problem

The e2e arrange step `borrowAgainstStream()` in `web/tests/e2e/fixtures/chain.ts` intermittently failed while setting up `repay-close.feature.spec.js` scenarios, throwing a misleading "event not found" error. The real cause had nothing to do with business logic or event decoding — it was a gas-estimation timing race on the `createBorrowerLoanPool` transaction that occasionally caused the transaction to revert out-of-gas after all of its real work (including the event emission) had already executed.

## Symptoms

- `borrowAgainstStream()` threw: `createBorrowerLoanPool receipt did not contain a BorrowerLoanPoolCreated event` (`web/tests/e2e/fixtures/chain.ts:488`).
- The failure was intermittent (~30% of runs) and not tied to a fixed scenario ordinal — across different runs of the same 5-scenario suite, the specific failing scenario moved around (3rd once, 5th another time), never landing on the same one twice.
- `mineAndGetReceipt()` (at the time, a thin wrapper around `publicClient.waitForTransactionReceipt`) never itself threw or surfaced any error — the transaction receipt came back fine, it just had a `status` of `"reverted"` and empty/irrelevant logs, so the failure only surfaced several steps later as a confusing "event missing" error instead of an on-chain revert.

## What Didn't Work

- **Trusting the first repro against a long-lived Anvil instance.** The first attempt to reproduce ran against a pre-existing Anvil process that had been up for ~1.5 hours (left over from earlier interrupted test sessions). That run produced an unrelated confound — `BlockOutOfRangeError` and `evm_revert ... failed: Resource not found (code -32001)` from stale/orphaned snapshot state — which had to be eliminated first by killing that Anvil process, starting a fresh one, and reseeding (`bash script/seed-local.sh`) before the target bug's signal was clean and reproducible. Lesson: don't trust a repro against a chain/environment you didn't just start yourself.
- **The ordering/leftover-state hypothesis.** Because the failing scenario index moved between runs, one hypothesis was that some earlier scenario in the suite left dirty on-chain state that a later scenario depended on. Running the specific failing scenario alone via `-g "<scenario name>"` immediately after a fresh reseed disproved this — it passed cleanly (continuing on to a separate, already-known `.position-card` UI timeout unrelated to this bug — see Related Issues below). This also confirmed the per-scenario `evm_snapshot`/`evm_revert` isolation fixture (`web/tests/e2e/fixtures/fork-snapshot.ts`) genuinely resets state between scenarios, since no `evm_revert` failures occurred in the clean environment.
- **Re-simulating the call via `publicClient.call({ ..., blockNumber: receipt.blockNumber - 1n })`.** This "succeeded," which looked like useful evidence but was actually a red herring: calling against the block *before* the failing block executes using that earlier block's timestamp as context, not the timestamp the failing transaction actually mined under. Since the underlying issue is a race between quote computation and mining time, replaying at the wrong timestamp context silently sidesteps the exact condition that caused the revert, producing a falsely reassuring "it works" result.

## Solution

Two changes in `web/tests/e2e/fixtures/chain.ts`:

**1. `mineAndGetReceipt` now checks receipt status (`web/tests/e2e/fixtures/chain.ts:142-148`):**

```ts
async function mineAndGetReceipt(hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`tx ${hash} reverted (block ${receipt.blockNumber}) — see \`cast run ${hash}\` for the trace`);
  }
  return receipt;
}
```

**2. `borrowAgainstStream` pads its gas estimate for `createBorrowerLoanPool` (`web/tests/e2e/fixtures/chain.ts:452-476`):**

```ts
const minAcceptable = (netToBorrower * 99n) / 100n; // 1% slippage, arrangement only

const estimatedGas = await publicClient.estimateContractGas({
  account: params.account,
  address: params.lending,
  abi: ovrfloLendingAbi,
  functionName: "createBorrowerLoanPool",
  args: [ids, params.streamId, fill, minAcceptable],
});
const hash = await client.writeContract({
  address: params.lending,
  abi: ovrfloLendingAbi,
  functionName: "createBorrowerLoanPool",
  args: [ids, params.streamId, fill, minAcceptable],
  gas: (estimatedGas * 130n) / 100n,
});
const receipt = await mineAndGetReceipt(hash);
```

The final `throw new Error("createBorrowerLoanPool receipt did not contain a BorrowerLoanPoolCreated event")` fallback remains at `web/tests/e2e/fixtures/chain.ts:488` as a last-resort guard for a genuinely missing event, but with the status check in place it should no longer be reachable via this gas-shortfall path.

## Why This Works

`createBorrowerLoanPool`'s `fill`/`minAcceptable` values are derived from `OVRFLOLending.quote()` (read at `web/tests/e2e/fixtures/chain.ts:429-442`), which is time-sensitive because it prices a Sablier-streamed obligation. Real wall-clock time elapses between reading the quote and the transaction actually mining a moment later, so the on-chain state at execution time can differ by a few wei from the state `eth_estimateGas` saw. That's normally harmless — except it's occasionally enough to flip one internal `SSTORE` between its cheaper "already-dirty slot" gas cost and its more expensive EIP-2929/EIP-2200 "clean-to-dirty" cost. When the estimate was computed against the cheap-path state but execution hits the expensive path, the transaction runs out of gas right at the very end: the `nonReentrant` modifier's cleanup write that resets the reentrancy-guard flag after the function body — including the `emit BorrowerLoanPoolCreated(...)` — has already fully executed. Diagnostic confirmation came from `cast run <hash>` on an actually-reverted transaction, which showed the entire function body running correctly (the `series()` lookup, `getStream()`, stream/PT transfers, and the event emit) before terminating in `ReentrancySentryOOG` with gas used pinned at the estimate.

Padding the gas estimate by 30% is the standard mitigation for exactly this class of flakiness, and it's appropriate here specifically because this arrangement code is simulating a real wallet signing a real transaction (an impersonated/unlocked Anvil dev account via a plain `WalletClient`, no local private key, no explicit `gas` originally) — real wallets and dApps routinely pad `eth_estimateGas` by 20-30% for the same reason, so this isn't a workaround specific to test code, it's adopting standard wallet behavior that the fixture had previously omitted.

The `mineAndGetReceipt` status check is valuable independent of the gas fix: it doesn't address the root cause by itself, but it means any *future* revert on any write in this file (gas-related or not) surfaces immediately as a clear "tx reverted, see `cast run <hash>`" message pointing at the actual failing transaction, rather than resurfacing many steps downstream as a confusing "expected event not found" error that gives no hint the real problem was a revert at all.

## Prevention

- Any `client.writeContract` call in `web/tests/e2e/fixtures/chain.ts` (or similar e2e arrange fixtures) whose calldata depends on a time-sensitive on-chain quote should pad its gas estimate (via `publicClient.estimateContractGas` plus a `gas` override, as done in `borrowAgainstStream`) rather than relying on the bare automatic `eth_estimateGas` behind `writeContract`. Other writes in this file that don't depend on a drifting quote (e.g. `approve`, `supplyLiquidity`, `withdrawLiquidity`) are lower risk but worth revisiting if similar flakiness ever appears there.
- `mineAndGetReceipt` (`web/tests/e2e/fixtures/chain.ts:142-148`) now enforces a receipt-status check for every write that routes through it in this file, so future callers get a real revert-hash failure signal for free instead of a confusing downstream symptom.
- When debugging a flaky on-chain e2e failure, capture `cast run <hash>` synchronously from inside the failing test (e.g. via `child_process.execSync`) before that scenario's per-run `evm_revert` erases the historical block. This is a general debugging technique worth naming explicitly: it's non-obvious, and it's easy to reach instead for `publicClient.call({ blockNumber: receipt.blockNumber - 1n })`, which replays at the *previous* block's timestamp context rather than the mined transaction's own context and can silently produce a falsely reassuring "it works" result for exactly the class of timing bug described here.
- This is not the first async-timing robustness fix landed in this file: `drainTokenBalance` (`web/tests/e2e/fixtures/chain.ts:227`) already calls `waitForNoncesToSettle(account)` before its own write, guarding against a related but distinct race — a nonce collision between a Playwright-driven UI action and an out-of-band viem call — from an earlier same-day session (session history). Both fixes share the same underlying lesson: e2e arrange helpers that sign transactions against a live local chain need to account for real wall-clock drift between "read state" and "submit transaction," whether that drift shows up as a stale nonce or a stale gas estimate.

## Related Issues

- `docs/solutions/architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md` — documents the `evm_snapshot`/`evm_revert` per-scenario isolation fixture that this diagnosis used and validated (no `evm_revert` failures occurred once running against a freshly-started Anvil fork); this doc's isolation guarantees held up under this investigation.
- `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md` — a different Anvil/gas-adjacent surprise (`forge script --broadcast`'s preflight `eth_getAccountInfo` reading upstream state instead of Anvil's locally-mutated balance), same general "Anvil returns something surprising during a tx-adjacent RPC call" family, but a distinct call site, root cause, and fix.
- `docs/solutions/ui-bugs/positionlist-blanket-error-hides-onchain-positions.md` — out of scope for this fix, but covers the separate, already-known issue behind 4 of the 5 `repay-close.feature.spec.js` scenarios also failing on an unrelated `.position-card` UI-locator timeout: the Ponder indexer (`tools/ponder/`) is not running in this dev environment, and the position list depends on it to render `LOAN`-tagged cards.
- `docs/solutions/logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md` — the same root-cause insight (`waitForTransactionReceipt`/`useWaitForTransactionReceipt` resolves normally on a reverted transaction instead of throwing; only `receipt.status` distinguishes success from revert) recurring at a different call site: this doc's fix covered the e2e fixture helper `mineAndGetReceipt`; that doc covers the identical gap in `web/hooks/useTxQueue.ts`, application code that live users depend on for every claim-all/borrow/repay queued transaction.
- `docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md` — a second, mechanistically distinct `async_timing` e2e race in the same borrow/lending surface. That one is not a gas-estimation drift in an ARRANGE fixture helper (this doc); it's a race between the app's own post-write query invalidation and a fixture-direct chain mutation injected in a `When` step, disabling a form button before the scenario's intended revert path could fire. Worth reading together if a new flake shows up in this area — same tags/category, same general "account for real wall-clock drift in e2e helpers" lesson, but don't assume it's a duplicate of either bug without checking which mechanism actually matches.
