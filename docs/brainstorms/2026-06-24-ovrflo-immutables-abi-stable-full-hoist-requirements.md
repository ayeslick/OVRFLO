---
title: "OVRFLO immutables + drop redundant SeriesInfo fields (ABI-stable full hoist)"
type: requirements
date: 2026-06-24
status: decided
supersedes: 2026-06-20-ovrflo-core-token-underlying-requirements.md
---

# OVRFLO immutables + drop redundant SeriesInfo fields (ABI-stable full hoist)

## Summary

`underlying` and `ovrfloToken` are constant per OVRFLO core (one pair per vault, by factory
discipline) but are currently stored **two** redundant ways:

1. **Per-market copies** in `SeriesInfo.ovrfloToken` / `SeriesInfo.underlying`
   (`src/OVRFLO.sol`), written by every `setSeriesApproved` and read by `deposit`/`claim`.
2. **Runtime fetch** from the factory registry via `IOvrfloAdmin.ovrfloInfo(this)` in
   `wrap`/`unwrap`/`sweepExcessUnderlying`.

This refactor makes both values `immutable` on the vault (single source of truth, set once at
construction) **and** drops the per-market stored copies, as one cohesive change — while
**preserving the public `series(market)` 8-tuple ABI** so the web app, `StreamPricing`, test
mocks, and positional-reading tests stay untouched.

## Why now / motivation

- Stronger on-chain invariant: one `(underlying, ovrfloToken)` pair per core enforced by
  construction (constructor), not just by factory call discipline.
- Gas: `wrap`/`unwrap`/`sweepExcessUnderlying` shed a per-call external `ovrfloInfo` read;
  `deposit`/`claim` shed a storage slot read for values that are now immutable (codegen load).
- Removes latent generality (different pairs per market) the core never uses and that
  contradicts the one-underlying-per-core model.
- Unblocks a cleaner `wrap(amount)` / `unwrap(amount)` signature (no `market` arg needed).

## Decision: Approach C — ABI-stable full hoist via a synthesized getter

Of the approaches considered (see "Alternatives rejected" below), the confirmed choice is:

- Add `address public immutable underlying;` and `address public immutable ovrfloToken;` to
  `OVRFLO`, set in the constructor (new params).
- **Drop** `ovrfloToken` and `underlying` from the `SeriesInfo` struct.
- Replace the `public series` mapping auto-getter with `mapping(address => SeriesInfo) internal
  _series;` plus a custom `function series(address market) public view returns (bool, uint32,
  uint16, uint256, address, address, address, address)` that reads `_series[market]` and
  **synthesizes** the two dropped positions (index 5 = `ovrfloToken`, index 6 = `underlying`)
  from the immutables. The returned 8-tuple shape, order, and types are **identical** to today,
  so `IOVRFLOSeriesRegistry.series` (defined in `src/StreamPricing.sol`) and every consumer are
  unchanged.
- `deposit` / `claim` read the immutables instead of `info.ovrfloToken` / `info.underlying`.
- `wrap` / `unwrap` / `sweepExcessUnderlying` read the immutables and **drop** the
  `IOvrfloAdmin.ovrfloInfo(this)` calls and the `IOvrfloAdmin` import.
- `setSeriesApproved` drops the `underlying` and `ovrfloToken` parameters.
- `OVRFLOFactory.deploy()` reorders to: create `OVRFLOToken` first (owner = factory) →
  `new OVRFLO(factory, treasury, underlying, tokenAddr)` → `token.transferOwnership(vault)`
  (one-step; `OVRFLOToken` uses a custom single-step ownership, not OZ two-step, so no
  `acceptOwnership` is needed).
- `OVRFLOFactory.addMarket()` drops the `info.underlying` / `info.ovrfloToken` args from the
  `setSeriesApproved` call. The factory's own `OvrfloInfo` struct (treasury / underlying /
  ovrfloToken) is **unchanged** — it remains the registry that `StreamPricing` and the book read
  via `ovrfloInfo`, and `addMarket` still uses `info.underlying` for the
  `IStandardizedYield.yieldToken() == info.underlying` check.

### Why this dominates the prior brainstorm's "B"

The 2026-06-20 exploration offered an ABI-stable middle ("B") that kept the `SeriesInfo` fields
populated from the core-level value so the auto-getter tuple stayed the same — but that
**retained the duplicated storage**. The insight reached here is that the auto-getter coupling
can be broken: drop the stored fields entirely and synthesize them in a custom getter. This
removes the storage duplication (the whole point) with the same ABI stability and the same
(confined) blast radius.

## Full blast-radius map (grounding)

The `SeriesInfo` struct order is: `approved(0)`, `twapDurationFixed(1)`, `feeBps(2)`,
`expiryCached(3)`, `ptToken(4)`, `ovrfloToken(5)`, `underlying(6)`, `oracle(7)`. Only indices 5
and 6 are vault-level redundant; the rest are genuinely per-market and stay.

**Changes required (Approach C):**

1. `src/OVRFLO.sol`
   - Constructor: `+ underlying, + ovrfloToken` params → two new immutables.
   - `SeriesInfo`: remove `ovrfloToken` and `underlying` fields.
   - `series` mapping → `internal _series`; add custom `series(address)` getter synthesizing
     indices 5 & 6 from the immutables (return order/types identical to today).
   - `setSeriesApproved`: drop `underlying` + `ovrfloToken` params; stop writing them.
   - `deposit`: use immutables for fee token + mint/stream asset.
   - `claim`: use `ovrfloToken` immutable for burn.
   - `wrap` / `unwrap` / `sweepExcessUnderlying`: use immutables; remove `ovrfloInfo` calls and
     `IOvrfloAdmin` import.
   - `previewRate` / `previewStream` / `previewDeposit` / `claimablePt`: switch `series[market]`
     → `_series[market]` (they never read the two dropped fields).

2. `src/OVRFLOFactory.sol`
   - `deploy()`: reorder to token-first (token → vault → `transferOwnership`).
   - `addMarket()`: drop the two args from the `setSeriesApproved` call.

3. Solidity tests (constructor + `setSeriesApproved` call-site updates only)
   - `test/OVRFLO.t.sol`: `new OVRFLO(...)` (x3 incl. 2 revert cases) and `setSeriesApproved`
     (x5) call sites.
   - `test/OVRFLOWrapUnwrap.t.sol`: `new OVRFLO(...)`.
   - `test/OVRFLOWrapUnwrap.invariant.t.sol`: `new OVRFLO(...)` + `setSeriesApproved(...)`.

**Unchanged (verified — the value of preserving the interface):**

- `src/StreamPricing.sol` + `IOVRFLOSeriesRegistry` interface (8-tuple return preserved).
- `src/OVRFLOBook.sol` (delegates to `StreamPricing`).
- `src/OVRFLOToken.sol` (no change).
- Mocks implementing `series()`: `test/StreamPricing.t.sol`, `test/OVRFLOBook.t.sol`.
- Tests destructuring `ovrflo.series(market)` by position:
  `test/OVRFLOFactory.t.sol` (idx 5+6), `test/OVRFLO.t.sol` (idx 5),
  `test/fork/OVRFLOFactoryMainnetFork.t.sol` (idx 5) — indices don't shift.
- Web app: `web/hooks/useAllMarkets.ts` (decodes `s[0]..s[7]`), `web/components/NewOvrfloModal.tsx`
  (reads `seriesData[5]` ovrfloToken, `[6]` underlying), `web/hooks/useUsdPrices.ts`
  (`m.underlying`), `web/components/Dashboard.tsx`, `web/components/NewOvrfloModal.tsx`.
- Web tests: `web/tests/hooks/useAllMarkets.test.tsx` (`markets[0].underlying`).
- Docs/plans: `README.md` example, the offer-gate solution doc, `plans/OVRFLO_ZAP_PLAN.md`
  (reads `series(market).underlying`), `plans/OVRFLO_FACTORY_AND_APP_UI_PLAN.md`.

## Alternatives rejected

- **A — Change the `series()` interface (drop the two return fields).** `StreamPricing` would
  source `ovrfloToken` from `ovrfloInfo(core)` (it already fetches it there as
  `registeredToken`). Removes one more minor read redundancy in `requireEligible`, but the
  blast radius includes `StreamPricing.sol` + `IOVRFLOSeriesRegistry`, both mocks, every
  positional-reading Solidity test (indices shift), **the entire web app** (`useAllMarkets`,
  `NewOvrfloModal`, web tests), README, and the zap plan. Rejected: large cross-stack break for
  a marginal gain; the user's criterion is "simplest to make the change."
- **B (prior brainstorm) — Keep `SeriesInfo` fields, fill from core-level value.** ABI-stable
  but retains the duplicated storage, which is the very redundancy being removed. Dominated by
  Approach C (synthesized getter).
- **D — Additive only (immutables, leave `SeriesInfo` + `setSeriesApproved` as-is).** Smallest,
  but leaves two sources of truth (immutable + stored copy) — more redundancy, not less, and
  fails the "entire refactor, not piecemeal" requirement.

## Constraints / invariants to preserve

- The `series(market)` return tuple shape, field order, and types must remain identical
  (hard ABI constraint driven by the off-chain web consumers).
- `factory` (formerly `adminContract`) is immutable (set once in constructor, no
  setter, no migration path); only `underlying` and
  `ovrfloToken` become immutable. `TREASURY_ADDR` is already immutable.
- `OVRFLOToken` ownership transfer remains one-step (`transferOwnership` directly sets `owner`);
  the deploy reorder must not introduce an `acceptOwnership` step.
- `setSeriesApproved` remains "called once per market, never overwritten" — claims depend on
  `ptToken` / `ovrfloToken` / expiry staying immutable for the life of outstanding deposits.
  Making `ovrfloToken` a constructor immutable strengthens, not weakens, this invariant.
- The factory's `OvrfloInfo` registry struct is unchanged (still consumed by `StreamPricing` /
  book via `ovrfloInfo`).

## Scope

**In scope:** vault-level `underlying`/`ovrfloToken` immutables; drop the two redundant
`SeriesInfo` stored fields; synthesized `series()` getter; factory deploy reorder; drop the
`ovrfloInfo` runtime fetch + `IOvrfloAdmin` import; update OVRFLO unit-test call sites.

**Out of scope:** `deposit`/`claim` economics; the `StreamPricing.requireEligible` double-read
of `ovrfloToken` (left as-is, not worth the interface break); non-18-decimal underlyings;
moving the Sablier approval to deploy-time (separate concern); any `IOvrfloAdmin`/`OvrfloInfo`
registry change.

## Success criteria

- `forge build` green; all existing tests pass (37 OVRFLOBook + OVRFLO/Factory/fork suites)
  with only constructor / `setSeriesApproved` call-site edits.
- `deposit`/`claim`/`wrap`/`unwrap`/`sweepExcessUnderlying` read `underlying`/`ovrfloToken`
  from immutables; no `ovrfloInfo` external call remains in `OVRFLO.sol`; `IOvrfloAdmin` import
  removed.
- `series(market)` returns the identical 8-tuple (same order/types) — verified by the
  untouched positional-reading tests and mocks compiling/passing unmodified.
- Web app market loading (`useAllMarkets`) and `NewOvrfloModal` continue to decode `series()`
  with no frontend change.
- One `(underlying, ovrfloToken)` pair per core enforced by construction.

## Sources / grounding

- `src/OVRFLO.sol` — `SeriesInfo` struct (field order confirmed), `series` public mapping,
  `setSeriesApproved`, `deposit`/`claim`/`wrap`/`unwrap`/`sweepExcessUnderlying`,
  `previewRate`/`previewStream`/`previewDeposit`/`claimablePt`, constructor.
- `src/OVRFLOFactory.sol` — `deploy()` order, `addMarket()` → `setSeriesApproved` call,
  `OvrfloInfo` registry.
- `src/OVRFLOToken.sol` — custom one-step `transferOwnership` (no `acceptOwnership`).
- `src/StreamPricing.sol` — `IOVRFLOSeriesRegistry.series` 8-tuple; `marketActive` reads idx 5;
  `requireEligible` `WrongAsset` check.
- `web/hooks/useAllMarkets.ts` — decodes `s[0]..s[7]` (idx 5 ovrfloToken, idx 6 underlying).
- `web/components/NewOvrfloModal.tsx` — `seriesData[3..6]` positional reads.
- `web/tests/hooks/useAllMarkets.test.tsx` — asserts `markets[0].underlying`.
- Test mocks: `test/StreamPricing.t.sol`, `test/OVRFLOBook.t.sol` (implement `series()`).
- Positional-reading tests: `test/OVRFLOFactory.t.sol`, `test/OVRFLO.t.sol`,
  `test/fork/OVRFLOFactoryMainnetFork.t.sol`.
- `plans/OVRFLO_ZAP_PLAN.md` — planned zap reads `series(market).underlying`.
- Prior exploration: `docs/brainstorms/2026-06-20-ovrflo-core-token-underlying-requirements.md`.
