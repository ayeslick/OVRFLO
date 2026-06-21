---
title: "Hoist (underlying, ovrfloToken) to OVRFLO core level"
type: requirements
date: 2026-06-20
status: exploring
---

# Hoist (underlying, ovrfloToken) to OVRFLO core level

## Summary

`underlying` and `ovrfloToken` are constant per OVRFLO core but are currently stored
per-series in `SeriesInfo` and re-passed into `setSeriesApproved` on every `addMarket`. This
brainstorm explores hoisting them to core-level state set once at deploy, weighed against the
fact that **everything works today** and the change has a wide blast radius — including an
ABI-shape change to the public `series(market)` getter that the web app decodes.

Motivation: cosmetic redundancy removal, a stronger on-chain invariant (one pair per core by
construction, not just by factory discipline), and unblocking a cleaner `wrap(amount)` /
`unwrap(amount)` signature for the wrap/unwrap primitive
(`docs/plans/2026-06-20-002-feat-ovrflo-wrap-unwrap-plan.md`).

## Problem Frame

Per `src/OVRFLOFactory.sol`, each core has exactly one `(underlying, ovrfloToken)` pair:
`deploy()` creates one `OVRFLOToken` and records one `underlying` in `ovrfloInfo`
(`src/OVRFLOFactory.sol:107-131`), and `addMarket` stamps that same pair onto every market via
`setSeriesApproved` (`src/OVRFLOFactory.sol:160-170`). The core stores N identical copies of
two values inside `SeriesInfo` (`src/OVRFLO.sol:60-69`) and reads them per-call in `deposit`
(`:298,302-304,311`) and `claim` (`:339-340`).

Nothing is broken. The cost is redundant calldata per `addMarket`, a redundant per-series
`ovrfloToken.approve(sablier, max)` (`src/OVRFLO.sol:224`), and latent generality the core
never uses (different pairs per market) that contradicts the stated one-underlying-per-core
model.

## Why this is non-trivial (blast radius)

The depth of the change depends entirely on whether the public `series(market)` tuple shape is
preserved.

**On-chain (src):**
- `src/OVRFLO.sol`: core-level storage, constructor signature, `setSeriesApproved` signature,
  `SeriesInfo` fields, `deposit`/`claim` reads, move the Sablier approval to deploy-time.
- `src/OVRFLOFactory.sol`: reorder `deploy()` to create the token before the core (so the core
  can take `ovrfloToken` at construction; token owner is transferred to the core afterward),
  and update the `setSeriesApproved` call site.

**Tests (must compile for `forge build` to pass):**
- `test/OVRFLO.t.sol` — constructor calls (`:83,95,98`), `_approveSeries` helper (`:531`),
  `series()` tuple destructuring (`:118-127,148-149`), `SeriesApproved` event assertion.
- `test/OVRFLOFactory.t.sol` — `series()` tuple reads (`:437,661`).
- `test/fork/OVRFLOFactoryMainnetFork.t.sol` — `series()` tuple reads (`:64,100-101`).
- `script/lib/OVRFLOTestFixtures.sol` — deploy/fixture wiring.

**Off-chain (runtime, not caught by `forge build`) — the hidden cost:**
- The web app decodes `ovrflo.series(market)` in `web/hooks/useUsdPrices.ts`,
  `web/components/Dashboard.tsx`, `web/components/StreamList.tsx`,
  `web/components/ClaimModal.tsx`, `web/components/NewOvrfloModal.tsx`, and
  `web/tests/hooks/useAllMarkets.test.tsx`. **Removing fields from `SeriesInfo` changes the
  getter's return tuple and breaks every one of these decode sites.** The `SeriesApproved`
  event can keep emitting the core-level values, so indexers keyed on the event are unaffected.

## Approaches

- **A — Full hoist (cleanest on-chain, widest blast).** Remove `underlying`/`ovrfloToken` from
  `SeriesInfo`; inject the pair into the core constructor as immutables; `deposit`/`claim` read
  the immutables; `setSeriesApproved` drops two params; Sablier approval moves to deploy.
  Touches src + all Solidity tests + the web `series()` decode sites (ABI-breaking getter).

- **B — Keep `SeriesInfo` shape, stop re-passing (ABI-stable middle).** Add the pair as
  core-level state set once at deploy; `setSeriesApproved` drops the two params but still fills
  the existing struct fields from the core-level value, so `series(market)` returns the same
  tuple. Removes redundant params and the per-series approve; web is untouched. Storage is still
  duplicated in the struct (cosmetic), but no ABI break.

- **C — Additive only (smallest blast, unblocks wrap/unwrap).** Add core-level
  `underlying`/`ovrfloToken` set at deploy and leave `setSeriesApproved`, `SeriesInfo`,
  `deposit`, and `claim` exactly as they are. `wrap`/`unwrap` (and anything else) read the new
  core-level values, enabling `wrap(amount)`/`unwrap(amount)`. Redundancy stays, but zero
  existing behavior, ABI, test, or web surface changes.

## Recommendation

Lean **C** for the immediate goal. It delivers the one thing that actually unblocks downstream
work — a core-level pair so `wrap`/`unwrap` need no `market` arg — with essentially no blast
radius and no risk to a working, audited-shape core. The redundant per-series params are
cosmetic; "everything works as is" argues against paying an ABI break and broad test/web churn
to remove them right now.

Reserve **A** for a deliberate, standalone cleanup pass (its own plan) if/when the team wants
the stronger on-chain invariant and is ready to update the web decode sites in lockstep. **B**
is the compromise if removing the redundant params matters but breaking the web getter does not.

## Scope

**In scope (this exploration):** deciding A/B/C for the core-level pair and how it feeds
`wrap`/`unwrap`.

**Out of scope:** the wrap/unwrap primitive itself (already planned); any change to
`deposit`/`claim` economics; non-18-decimal underlyings.

## Open Questions

- Is breaking the `series(market)` getter tuple acceptable given the web decode sites, or is
  ABI stability a hard constraint (which would rule out A)?
- If C is chosen, should the core-level pair be set in the constructor (requires the factory
  `deploy()` token-first reorder) or via a one-time initializer the factory calls after deploy?
- Does any external integrator (beyond this repo's web app) read `series(market)` fields?

## Success Criteria

- `wrap`/`unwrap` can be implemented as `wrap(amount)`/`unwrap(amount)` against a single
  core-level pair and reserve.
- Whichever approach is chosen, `forge build` stays green and the web app still decodes market
  state correctly (A additionally requires updating the web decode sites).
- The one-pair-per-core property is at least as strong as today (A makes it core-enforced).

## Sources / Research

- Core: `src/OVRFLO.sol` — `SeriesInfo` (`:60-69`), `setSeriesApproved` (`:197-227`) incl.
  per-series Sablier approve (`:224`), `deposit` reads (`:298,302-304,311`), `claim` reads
  (`:339-340`), constructor (`:175-181`).
- Factory: `src/OVRFLOFactory.sol` — `deploy()` (`:107-131`), `addMarket` →
  `setSeriesApproved` (`:160-176`).
- Token: `src/OVRFLOToken.sol` — owner is the core; ownership transferred post-deploy.
- Solidity call sites: `test/OVRFLO.t.sol`, `test/OVRFLOFactory.t.sol`,
  `test/fork/OVRFLOFactoryMainnetFork.t.sol`, `script/lib/OVRFLOTestFixtures.sol`.
- Web `series()` decode sites: `web/hooks/useUsdPrices.ts`, `web/components/Dashboard.tsx`,
  `web/components/StreamList.tsx`, `web/components/ClaimModal.tsx`,
  `web/components/NewOvrfloModal.tsx`, `web/tests/hooks/useAllMarkets.test.tsx`.
- Downstream consumer: `docs/plans/2026-06-20-002-feat-ovrflo-wrap-unwrap-plan.md` (KTD1/KTD2).
