---
title: "adjust-rate.feature's whole suite had a structurally impossible precondition — the seeded local fork only ever offers one rate tick"
date: 2026-07-28
category: test-failures
module: web/tests/e2e/steps/adjust-rate.ts
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "All three scenarios in web/tests/e2e/adjust-rate.feature (\"Happy path — move idle liquidity to a new rate\", \"Error state — idle amount changes after the form opens\", \"Cross-cutting — market matured disables the move with a caption\") depend on selecting a *second* available rate tick to move liquidity to, but the freshly seeded local Anvil fork only ever exposes one valid tick."
  - "OVRFLOLending's constructor (src/OVRFLOLending.sol:252-253) sets `aprMinBps = LAUNCH_APR_BPS` and `aprMaxBps = LAUNCH_APR_BPS` — the same constant assigned to both bounds, so every freshly deployed lending market starts with `aprMinBps == aprMaxBps`."
  - "script/seed-local.sh, which every e2e run seeds the local fork from, has zero references to `setAprBounds` or the factory-forwarded `setLendingAprBounds` — confirmed via grep (no matches) — so nothing ever widens the range before the suite runs."
  - "Whatever step drove \"select the second available rate\" against a real seeded fork would find no second tick to select at all — a structurally impossible precondition for the entire feature file, not a bug in any one scenario's own steps."
root_cause: incomplete_setup
resolution_type: test_fix
related_components: [src/OVRFLOLending.sol, src/OVRFLOFactory.sol, script/seed-local.sh, web/tests/e2e/fixtures/chain.ts, web/tests/e2e/steps/adjust-rate.ts, web/tests/e2e/adjust-rate.feature]
tags: [adjust-rate, apr-bounds, e2e, playwright, seed-local, launch-apr-bps]
---

# adjust-rate.feature's whole suite had a structurally impossible precondition — the seeded local fork only ever offers one rate tick

## Problem

`web/tests/e2e/adjust-rate.feature` exists to exercise the ADJUST RATE action: a lender picks a *different* rate tick off the ladder and the app moves their idle liquidity from the old tick to the new one. Every one of its three scenarios assumes at least two distinct, valid rate ticks exist on the seeded market — the whole point of "adjust" is moving liquidity from tick A to tick B.

But `OVRFLOLending`'s constructor deliberately launches a market with only one valid tick. `src/OVRFLOLending.sol:33-34` defines:

```solidity
/// @notice Launch APR (10%) used as the initial min and max APR bound.
uint16 public constant LAUNCH_APR_BPS = 1000;
```

and the constructor (`src/OVRFLOLending.sol:252-253`) assigns the same constant to both bounds:

```solidity
aprMinBps = LAUNCH_APR_BPS;
aprMaxBps = LAUNCH_APR_BPS;
```

This is a deliberate single-tick launch state, consistent with this repo's convention that a market launches at one fixed rate and widens later via a governance action — the range only opens up once the owner calls `setAprBounds` (`src/OVRFLOLending.sol:265-275`, `onlyOwner`) or, in the real admin path, the factory-forwarded `setLendingAprBounds` (`src/OVRFLOFactory.sol:280-284`, which calls `OVRFLOLending(lending).setAprBounds(...)` per the "multisig -> factory -> vault/lending" admin-forwarding pattern documented in AGENTS.md).

`script/seed-local.sh` — the script every e2e run seeds its local Anvil fork from — never calls either function:

```
$ grep -n "setAprBounds\|setLendingAprBounds" script/seed-local.sh
(no matches, exit 1)
```

So a freshly seeded local fork has `aprMinBps == aprMaxBps == 1000` (10%) with no second tick anywhere on the ladder. Any scenario that tries to "select the second available rate" against this fork has no second rate to select — the precondition the entire feature file assumes is structurally impossible to satisfy from a plain seed.

## What Didn't Work

There isn't a multi-attempt investigation trail to report here, and it would be dishonest to invent one. `git log -p -S "widenAprBounds" -- web/tests/e2e/fixtures/chain.ts web/tests/e2e/steps/adjust-rate.ts` shows the fixture helper and the new step were both introduced together, in one diff, inside a single large commit: `c1024d9` ("fix: harden local E2E bootstrap and treat on-chain reverts as failures"). That commit's body is explicit about its origin — "fixture fixes from the first full suite run" — meaning this was one of several problems discovered together when `adjust-rate.feature` was run against the seeded fork for the first time, not a fix arrived at after earlier failed attempts landed in git history. There's no earlier commit that tried a different approach (e.g. hardcoding a second APR value in the fixture, or relaxing the feature file's assertions) and then got reverted or replaced — the fix shown below is the only version that ever existed in this repo's history for this specific gap.

## Solution

A new `Given` step was added to `web/tests/e2e/steps/adjust-rate.ts:22-25` that widens the market's APR bounds before anything else in the file runs:

```ts
Given("the market offers multiple rate ticks", async () => {
  const deployment = readDeployment();
  await widenAprBounds({ factory: deployment.factory, lending: deployment.lending, aprMinBps: 1000, aprMaxBps: 1200 });
});
```

It's backed by a new fixture helper, `widenAprBounds`, in `web/tests/e2e/fixtures/chain.ts:293-301`:

```ts
export async function widenAprBounds(params: { factory: Address; lending: Address; aprMinBps: number; aprMaxBps: number }) {
  const hash = await ownerClient.writeContract({
    address: params.factory,
    abi: ovrfloFactoryAbi,
    functionName: "setLendingAprBounds",
    args: [params.lending, params.aprMinBps, params.aprMaxBps],
  });
  await mineAndGetReceipt(hash);
}
```

`widenAprBounds` calls `OVRFLOFactory.setLendingAprBounds` from `ownerClient` — the same address `script/seed-local.sh` deploys the factory from, which the fixture file's own comment documents as doubling for the local "multisig" — rather than calling `OVRFLOLending.setAprBounds` directly. That mirrors the real admin path (multisig -> factory -> lending), the same forwarding pattern the rest of the fixture file already uses for other admin-gated arrangement steps.

The new step is wired into the very top of `adjust-rate.feature`'s `Background:` block (`web/tests/e2e/adjust-rate.feature:6-9`):

```gherkin
  Background:
    Given the market offers multiple rate ticks
    And I am on the markets page
    And my wallet is connected
```

so every scenario in the file inherits it automatically, without needing to be repeated per-scenario.

## Why This Works

The inline comment directly above the new step, `web/tests/e2e/steps/adjust-rate.ts:17-21`, states the reasoning verbatim:

```
// seed-local.sh never widens OVRFLOLending's constructor default of
// aprMinBps == aprMaxBps (a single-tick launch state — see widenAprBounds's
// own comment in chain.ts), but every scenario in this file needs a second,
// distinct tick to move liquidity *to*. Must run before "my wallet has
// supplied liquidity..." reads aprMinBps, so the Background puts this first.
```

The ordering requirement is real, not defensive boilerplate. `Given("my wallet has supplied liquidity to the active market", ...)` (`web/tests/e2e/steps/adjust-rate.ts:27-37`) reads the *current* `aprMinBps` off-chain before supplying:

```ts
Given("my wallet has supplied liquidity to the active market", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await supplyLiquidityAs({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: readSecondaryMarket(),
    aprBps: aprMinBps,
    amount: SUPPLY_AMOUNT,
  });
});
```

If the bounds were widened *after* this step ran, `readAprBounds` would already have snapshotted whatever `aprMinBps` was at that point in time and used it to size the supplied position. Placing `"the market offers multiple rate ticks"` first in the `Background:` guarantees the on-chain widen (`aprMinBps=1000, aprMaxBps=1200`, per `adjust-rate.ts:24`) is committed and mined before `readAprBounds` is ever called, so the supplied position's rate and the ladder it's being moved within are both drawn from the same, already-widened state — there's no window where the two could observe different bounds.

The widen itself is the correct fix rather than a workaround because it doesn't fabricate test-only behavior: it invokes the exact same admin surface (`OVRFLOFactory.setLendingAprBounds` -> `OVRFLOLending.setAprBounds`) that a real timelocked multisig would use to widen a market's rate range post-launch. The launch-time single-tick state (`aprMinBps == aprMaxBps == LAUNCH_APR_BPS`) is intentional product behavior, not a seeding bug — a market genuinely does launch pinned to one rate and only gains a ladder once governance decides to widen it. `adjust-rate.feature`'s scenarios are testing post-widen behavior, so their `Background` needs to establish the post-widen state explicitly rather than assuming the constructor's default already provides it. Note that `script/seed-local.sh` itself was left untouched — the fix lives entirely in the e2e test framework (a new step + a new fixture helper), not in the seed script, since widening bounds is a per-suite testing concern, not a property every consumer of the seeded fork needs.

## Prevention

- When a `.feature` file's own name and scenario descriptions imply a precondition ("adjust... to a *different* rate", "second available rate"), check the actual seeded/constructor default the fixture depends on before assuming the seed script already provides it. Here, grepping `script/seed-local.sh` for the relevant setter (`setAprBounds` / `setLendingAprBounds`) and finding zero hits was the concrete signal that the precondition was never established.
- Any Gherkin step that reads live on-chain state as an input to another action (here, `readAprBounds` inside `"my wallet has supplied liquidity..."`) is order-sensitive with respect to any other step in the same file that mutates that same state. When adding an arrangement step that changes contract state other steps depend on, place it first in `Background:` rather than trusting Gherkin's declaration order to be self-evidently correct — and document the ordering requirement inline, the way `adjust-rate.ts:17-21` does, so a future edit to `Background:`'s step order doesn't silently break the dependency.
- Prefer widening state through the same admin-forwarding path production governance would use (factory -> lending, per AGENTS.md's "multisig -> factory -> vault/lending" pattern) over calling an owned contract's setter directly from a test fixture, even though the fixture's `ownerClient` happens to hold the same address as both the factory owner and the "local multisig." This keeps the arrangement code exercising the same code path production callers use, so a bug in the forwarding function itself (`OVRFLOFactory.setLendingAprBounds`) would also be caught by this fixture rather than silently bypassed.

## Related Issues

- `docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md` — same commit, same day, same broad theme ("`seed-local.sh` has an unstated assumption that silently breaks an e2e fixture downstream"), but a different mechanism: that doc is about external Pendle market staleness/wall-clock drift, not an internal contract launch default.
- `docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md` — explains why `widenAprBounds` calls `factory.setLendingAprBounds(...)` rather than `OVRFLOLending.setAprBounds(...)` directly (the multisig -> factory -> lending forwarding pattern).
- `docs/solutions/logic-errors/adjust-rate-multicall-shrink-race.md` — a different bug in the same feature area (a multicall/receipt race in the ADJUST RATE UI flow itself, not a test-fixture precondition gap); useful for distinguishing "the scenarios couldn't even run for lack of a second tick" from "the happy-path multicall had a receipt bug."
