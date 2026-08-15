# Factory as the bootstrap anchor

Status: requirements recorded 2026-08-15. Not build-ready (no ignorance-lens sweep).
Independent of `2026-08-15-001` through `-005`. Ships in any order.

## The invariant

> The factory anchor must always be resolved before application startup. Protocol addresses
> discovered from that anchor must remain **loading** until positively resolved, and must never be
> represented by zero-address sentinels that can collapse into an empty protocol state.

Everything below serves that sentence.

## Two kinds of truth, and the app conflates them

```
STATIC BOOTSTRAP TRUTH — configuration. Absent = configuration failure.
    chainId
    factory address
    RPC endpoints

DISCOVERED PROTOCOL TRUTH — read from the chain. Unresolved = loading.
    factory.ovrfloStream()
    factory.ovrflos(...) / ovrfloInfo(...) / ovrfloToLending(...)
    factory.approvedMarketAt(...)
        ↓
    vault.series(...) · lending state · stream state
```

You cannot bootstrap a registry without knowing where the registry is. The factory address is the
one unavoidable static anchor, and it is not duplicated derived truth — it is the root identifier
that lets you enter the graph. Everything reachable *from* it is discovered.

An earlier draft of this plan got that backwards: it proposed resolving the stream address from the
factory and treating an unresolved anchor as a loading state. **The factory address itself is never
loading.** If it is absent, that is a misconfigured build, not a protocol in flight.

## The collapse this prevents, verified

The two rules are currently inverted — the derived address is required and the root is nullable:

- `web/lib/config.ts:221` — `SABLIER_LOCKUP_ADDRESS = parseRequiredAddress(...)`. Throws on absent
  or zero, in every profile.
- `web/lib/config.ts:225` — `factoryAddress = parseAddress(...)`, which at `:110` degrades a missing
  value to `ZERO_ADDRESS` outside production.

And the degradation is not inert. In `web/hooks/useOvrflos.ts`:

```ts
query: { enabled: isConfiguredAddress(factory) },   // :16  — disabled when factory is zero
const count = countRead.data ?? 0n;                 // :19  — a disabled query has no data
```

A missing factory disables the read, the read has no data, `count` becomes `0n`, and the app reports
**zero vaults**. "Cannot ask" has become "the protocol is empty" — the same class of failure this
codebase already fixed for streams, sitting one level further up, at the root.

## Product contract

- The factory address is **required and non-zero in every profile**, including local and test.
  `ZERO_ADDRESS` is not a legitimate runtime state for the protocol root.
- Every address derived from the factory is **discovered**, not configured. Remove
  `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS`, `NEXT_PUBLIC_OVRFLO_ADDRESS`, and
  `NEXT_PUBLIC_OVRFLO_LENDING` from runtime configuration.
- Discovery is a discriminated union. No zero-address sentinel and no empty array stands in for an
  unresolved read.
- `[]` means empty **only** in the `ready` state.
- Local and test environments get a real factory address from the bootstrap tooling. A test that
  needs a different one injects it explicitly rather than relying on a zero fallback.

## The shape

```ts
type ProtocolBootstrap =
  | { status: "loading" }
  | { status: "ready"; factory: Address; stream: Address; vaults: readonly Vault[] }
  | { status: "unavailable"; failures: readonly ReadFailure[] };
```

Never `{ stream: ZERO_ADDRESS, vaults: [] }` while reads are outstanding.

```
factory known (static)
        ↓
   read the canonical graph
        ├── still reading → LOADING
        ├── RPC failure   → UNAVAILABLE
        └── success       → READY
                              │
                           [] vaults
                              ↑
                    only here does [] mean empty
```

## The build gate changes anchor, not strictness

Today `tools/scripts/write-deployment-artifact.mjs` derives the stream address from `vault.sablierLL()`
and `lending.sablier()` and requires the two to agree. That check compares **two derived facts
against each other**, when registration already forced both to agree with the factory —
`registerOvrflo` and `registerLending` revert `SablierMismatch` otherwise.

Anchor it where the authority is:

```
DEPLOYMENT ARTIFACT
        ↓
factory anchor
        ├── does code exist at the address?
        ├── is the deployment block and hash correct?
        ├── does the registry contain vault X?
        ├── does the factory map X → lending Y?
        ├── is the canonical stream S?
        └── do registered markets match the expected deployment?

then, as integrity checks on the children:
        vault.factory()   == factory
        lending.factory() == factory
        lending.core()    == vault
        vault.sablierLL() == factory.ovrfloStream()
        lending.sablier() == factory.ovrfloStream()
```

The separation this produces is the point:

| | owns |
|---|---|
| factory registry | registry truth |
| child immutables | integrity verification |
| deployment artifact | historical and provenance record |
| frontend env | bootstrap transport and configuration |

**Removing a fact from browser configuration does not remove it from deployment verification.** The
artifact should still know the vault, lending, stream, and deployment blocks. Only the browser stops
being told them.

## What the runtime environment becomes

```
NEXT_PUBLIC_CHAIN_ID
NEXT_PUBLIC_OVRFLO_FACTORY
NEXT_PUBLIC_RPC_URL
NEXT_PUBLIC_RPC_FALLBACK_URLS
```

Plus build and origin metadata. Not `OVRFLO_ADDRESS`, `OVRFLO_LENDING`, `SABLIER_LOCKUP_ADDRESS`, or
the per-contract deployment blocks and hashes, as *protocol* inputs.

This also settles the permanent interface. A static HTML build carrying
`const CHAIN_ID = 1; const FACTORY = "0x…";` is acceptable, and is about as small as the anchor gets.
Making the factory itself discoverable — through ENS or a permanent registry — does not remove the
anchor, it moves it one level up. Do not do that without a concrete need.

## What this touches

The address pipeline is five stages and a change missing from any one leaves the browser blind:

- `web/lib/config.ts` — factory to `parseRequiredAddress`; delete the three derived address parsers.
- `web/hooks/useOvrflos.ts` — the `?? 0n` collapse at `:19`, and the `enabled` gate at `:16`.
- `tools/scripts/write-deployment-artifact.mjs` — re-anchor derivation on the factory.
- `web/scripts/verify-deployment-input.mjs` — `FIELD_BINDINGS` loses the derived entries and gains
  the registry checks.
- `tools/scripts/write-env.sh` — both the `jq -e` assertion **and** the fixed
  `echo "NEXT_PUBLIC_..."` list. A variable removed from the artifact but left in the echo list
  writes an empty value.
- `script/seed-local.sh`, `deployments/local.json`, `web/.env.example`, `web/.env.local`.

**Check before changing:** `web/lib/invalidate.ts` matches stream reads by finding the lockup address
inside the serialised query key. The discovered address must be the one that lands there, or
post-write refresh silently stops matching.

## Test accountability

- **A zero or absent factory fails the build**, in every profile including local. Assert the module
  throws rather than degrading.
- **Unresolved discovery is loading, never empty.** Assert `useOvrflos` reports loading — not zero
  vaults — while the factory read is outstanding. This is the `?? 0n` collapse; it is the reason the
  plan exists.
- **`[]` means empty only when ready.** Assert a successful read of a registry with no vaults is
  `ready` with an empty list, and is distinguishable from both other states.
- **The build gate rejects a registration the factory does not know.** Point a vault at a different
  lockup than `factory.ovrfloStream()` and assert `verify-deployment-input.mjs` fails. This proves
  the gate still guards after moving its anchor.
- **Post-write invalidation still matches** once the lockup address is discovered rather than
  configured.

## Out of scope

- Any contract change. `ovrfloStream`, `SablierMismatch`, and the registration checks already exist
  and are correct.
- Making the factory address itself discoverable.
- The lens address from `2026-08-15-005`. It has no on-chain binding and is a separate decision —
  though this plan's rule applies to it: it is configuration, so it is required, not nullable.
