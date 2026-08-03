# Client state map — index

The catalog of **client** UI state for the Markets app: React state and machines,
query/wagmi/executor state, and the facts the UI displays. It exists so an agent can
answer *"what state do I touch, and who depends on it?"* before editing.

**This is not the Solidity state map.** `x-ray/` remains the authority for on-chain
entry points and contract state. This catalog covers the browser. A key marked
`on-chain` here describes *the browser's copy of* a chain fact and who depends on
that copy — it neither summarises nor supersedes `x-ray/`, and a question about
contract behaviour is answered there, not here.

## Layout

```
state/
├── README.md          this index
├── keys/              source of truth — one entry per state key
└── functions/         GENERATED index — never edited by hand
```

**Keys are the source of truth; the function/module index is generated from them.**
A hand-maintained second index drifts and then lies about blast radius — which is
exactly the question this catalog exists to answer. If the generated index is wrong,
fix the keys and regenerate.

## The catalog

| File | Contents |
|---|---|
| `keys/README.md` | Entry format the generator parses, and the naming rules |
| `keys/view-state.md` | Selection, expansion, overlay — what the user is looking at |
| `keys/form-state.md` | Action-form input and per-form guard state |
| `keys/execution-state.md` | Executor phase, write-flow, Claim All queue latches |
| `keys/chain-reads.md` | The browser's copies of chain facts, and the query keys holding them |
| `keys/projection.md` | Browser-side log projection — candidate sets, never authorities |
| `functions/INDEX.md` | **Generated.** Module → keys, trust-domain exposure per module, and the key → readers reverse lookup |

## Regenerating

```sh
node tools/scripts/generate-state-function-index.mjs           # write the index
node tools/scripts/generate-state-function-index.mjs --check   # verify only; non-zero on drift
```

`--check` is the form a CI or presence gate should call. The generator also
validates the catalog as it reads it: an unknown `trust_domain`, an empty
`writers`/`readers` list, a duplicate key, or an unrecognised field fails the run
rather than being silently dropped.

## Minimum fields per key

From `../SCHEMAS.md` §3 — the shape briefs and review lenses read:

| Field | What it must answer |
|---|---|
| `key` | Stable state-key identifier |
| `trust_domain` | `on-chain` · `projection` · `pure-client` |
| `writers` | Every module/hook that sets it |
| `readers` | Every module/hook that consumes it |

Entries also carry a `notes` field. It is deliberately outside the parsed set: it
holds fail-closed guidance, gate warnings, and drift caveats without enlarging the
machine-readable core.

## Trust domains, briefly

Full rules in `../SCHEMAS.md` §2. The load-bearing part:

- `on-chain` is authoritative. **Anything gating an action must be this.**
- `projection` is a candidate set — it narrows *which ids to ask about* and decides
  nothing.
- `pure-client` never stands in for chain truth.

Moving a fact between domains, or letting a `projection` value feed a gate, is a
trust-domain change: summary ADR required, and it escalates to the Owner
(`../REVIEW.md`).

Every `projection` entry carries fail-closed guidance, because *empty* and *could
not ask* lead to opposite user actions and must never share a representation
(`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).

## How to use it

**"Who reads X?"** — open the key's entry; `readers` is the answer, with each
module's role. `functions/INDEX.md` carries the same list in a single table, plus
the inverse: what one module touches, and how much `projection` state it is exposed
to.

**"What is safe to change?"** — a `pure-client` key with readers in one file is
local. A key read across regions, or any `projection` key, is not: check the
fail-closed notes before changing what a non-`ready` status renders.

**Before editing Markets UI** — list the keys you will read or write and their
dependent modules, per the charter's step 2 (`../README.md`).

## Sources the catalog is built from

- `web/hooks/` — the hooks that read and write client state
- `web/lib/query-keys.ts` — query key surface
- `web/lib/discovery/` — projection boundary, and where `projection` stops
- `web/lib/read-outcome.ts` — the four-status outcome shape projections resolve to
- `web/lib/query-resource-registry.ts` · `web/lib/invalidate.ts` — post-write refresh scoping
- `web/components/action-flow/` — executor and transaction-queue state
