# Factory as the canonical stream anchor

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Independent of `2026-08-15-001` through `-005`. Ships in any order.

## Problem

The protocol already decided which stream lockup is canonical, and the browser does not ask it.

`OVRFLOFactory.ovrfloStream` is set once and never again, and registration refuses any vault or
lending market bound to a different lockup — `registerOvrflo` and `registerLending` both revert
`SablierMismatch`. So after the factory is configured, **the factory is the single authority on
which stream contract is real**, and the chain enforces it.

The frontend takes a different route. `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` carries the address as
its own environment variable, and the production build gate derives it independently — 
`tools/scripts/write-deployment-artifact.mjs` reads `vault.sablierLL()` and `lending.sablier()` and
requires the two to agree.

That check is not wrong, but it is checking the wrong thing. It confirms two registered children
agree with each other, when both were already forced to agree with the factory at registration
time. The one contract that *declares* canon is the one nobody reads.

**Three sources of the same truth**: the factory's `ovrfloStream`, the vault's `sablierLL`, and an
environment variable. Only the first is authoritative, and it is the only one the frontend does not
consult.

## Product contract

- The frontend resolves the stream lockup from `factory.ovrfloStream()`. One source.
- `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` is removed, not merely deprecated. A variable that still
  exists is a variable something still reads.
- A factory whose `ovrfloStream` is unset fails closed — the app does not fall back to a
  configured address, because falling back is what allows the two to disagree.
- No behaviour change to any contract. This is a read-path change only.

## Approach

Read the anchor from the factory, which the frontend already has as
`NEXT_PUBLIC_OVRFLO_FACTORY`, and delete the separate variable.

The build-time gate changes shape rather than disappearing. Today it derives the stream address from
the vault and checks it against an env var. It should derive from `factory.ovrfloStream()` and check
that the registered vault and lending market agree — the same comparison, anchored at the contract
that enforces it. That keeps the immutable-build guarantee while removing the duplicated truth.

## What this touches

The address crosses the same five-stage pipeline every other address does, and a change missing from
any stage leaves the contract deployed and the browser blind:

- `web/lib/config.ts` — `SABLIER_LOCKUP_ADDRESS` is currently the **only** address using
  `parseRequiredAddress`, so removing it changes the module-load failure surface. Confirm nothing
  else depends on that throw.
- `tools/scripts/write-deployment-artifact.mjs` — derive from the factory rather than the vault.
- `web/scripts/verify-deployment-input.mjs` — the `FIELD_BINDINGS` entry.
- `tools/scripts/write-env.sh` — both the `jq -e` assertion and the fixed `echo "NEXT_PUBLIC_..."`
  list. A variable removed from the artifact but left in the echo list writes an empty value.
- `script/seed-local.sh` and `deployments/local.json` — the artifact key.
- `web/.env.example`, `web/.env.local` — regeneration required.

Every consumer of `SABLIER_LOCKUP_ADDRESS` moves to the resolved value. `web/hooks/useStreams.ts` and
`web/lib/invalidate.ts` are the notable ones — invalidation matches stream reads by finding the
lockup address inside the serialised query key, so the resolved address must be the one that lands
there. Check that before changing anything, or post-write refresh stops matching.

## The ordering problem this creates

Reading the anchor from a contract makes it **asynchronous**, where an environment variable is
available at module load. `SABLIER_LOCKUP_ADDRESS` is imported synchronously today.

That is the whole difficulty of this change, and it must be decided before building:

- Resolve it once at app boot and hold it, so consumers stay synchronous.
- Or make it a normal read and let every consumer handle a loading state.

The first preserves today's shape and is almost certainly right, but it needs a stated answer for
what the app renders while the resolution is in flight — and that answer must not be "treat it as
unconfigured", because `isConfiguredAddress` gates reads and an unconfigured lockup renders a
populated wallet as empty. That is the same failure mode plan `005` records for its own address.

## Test accountability

- **A factory with an unset `ovrfloStream` fails closed.** Assert the app reports unavailable rather
  than falling back to any address or rendering an empty wall.
- **Resolution in flight is loading, not empty.** Assert no book reports `ready` with zero rows
  while the anchor is unresolved.
- **The build gate rejects a mismatched registration.** Point the factory at one lockup and a
  registered vault at another; assert `verify-deployment-input.mjs` fails the build. This is the
  test that proves the gate still guards after moving its anchor.
- **Post-write invalidation still matches.** Perform a write and assert the stream book refetches —
  the resolved address must be the one in the query key.

## Out of scope

- Any contract change. `ovrfloStream`, `SablierMismatch`, and the registration checks already exist
  and are correct.
- The other four addresses. Factory, vault, lending, and token keep their current derivation.
- The lens address from `2026-08-15-005`, which has no on-chain binding and is a separate decision.
