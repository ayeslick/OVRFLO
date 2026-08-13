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
| `keys/view-state.md` | Lens, selection, USD mode, shell chrome, first-run memory |
| `keys/form-state.md` | Action-form input and per-form guard state |
| `keys/execution-state.md` | Executor phase, write-flow, and transaction-lifecycle latches |
| `keys/chain-reads.md` | The browser's copies of chain facts, USD feed, and the query keys holding them |
| `keys/schedule.md` | Clock, interpolation inputs, payoff derivations, event freshness |
| `keys/projection.md` | Stream-candidate discovery only — never an authority, never a gate |
| `functions/INDEX.md` | **Generated.** Module → keys, trust-domain exposure per module, and the key → readers reverse lookup |

## Regenerating

```sh
node tools/scripts/generate-state-function-index.mjs           # write the index
node tools/scripts/generate-state-function-index.mjs --check   # verify only; non-zero on drift
```

`--check` is what the presence gate already runs — `npm --prefix web run lint:maps`
invokes it as `lint:state-index`. The generator also
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
- `projection` is a candidate set — it narrows *which ids to ask about* and may never
  decide what is *allowed*. It may still deny: a projection that fails closed and
  blocks an action is required, not a violation.
- `pure-client` never stands in for chain truth.

Promoting a fact from `projection` to `on-chain`, or letting a `projection` value feed a gate, is a
trust-domain change: summary ADR required, and it escalates to the Owner
(`../REVIEW.md`).

When two copies of the same chain fact disagree — an optimistic overlay against a
receipt, a cached read against a fresh one — the freshness precedence ladder in
`../SCHEMAS.md` §2 decides which wins.

Every `projection` entry carries fail-closed guidance, because *empty* and *could
not ask* lead to opposite user actions and must never share a representation
(`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).

## Authoring new state

Two rules for adding state, adapted from ponytail-fullstack-web3
(`frontend-state`, `frontend-flow`):

**Where does the value belong?** Walk this ladder before reaching for
`useState`; stop at the first home that fits:

1. the URL;
2. browser/platform state (focus, media queries, native form controls);
3. server or chain state — read it, don't copy it;
4. the query cache (wagmi/TanStack already dedupe by query key);
5. derived render state — compute it, don't store it;
6. a persisted operation (the execution registry, the queue);
7. genuinely client-owned application state — only now a new key.

A new key in `keys/` is the *last* rung, and it arrives with its trust domain,
writers, and readers declared.

## The operation lifecycle

The canonical write-operation lifecycle (adapted from ponytail-fullstack-web3's
`web3-transaction` model). The executor phases and queue statuses cataloged in
`keys/execution-state.md` are projections of it, and a rebuilt executor is
written *against* it rather than rediscovering it:

```text
prepared → simulated → awaiting wallet → rejected | signed → submitted
→ pending | replaced | dropped → reverted | confirmed → refreshed / reconciled
```

Two rules ride with it:

- **Identity.** An operation is bound at start to intent, account, chain, and
  deployment — and once signed, to nonce, calldata, and hash. A later account or
  chain switch never re-attributes it (`action.wallet-changed`,
  `UI-SHELL-WALLET-CHANGED`).
- **Re-simulation.** Any change to what the transaction depends on — state,
  account, chain, deadline, allowance, or quote — invalidates the prepared plan
  and routes through re-simulation and visible re-confirmation, never silent
  resubmission. The incumbents already enforce this (`writeflow.is-preparing`
  generation counting, the queue's pre-submit rebuild, the `re-confirm` and
  `needs-review` states).

**An operation is a state machine, not a collection of booleans.** When a flow
has a real lifecycle, model it as one named state with explicit transitions
(`executor.status`, the `queue.rows` statuses) — never as independent
`isLoading` / `isSuccess` / `error` flags per component, which can contradict
each other. Every transition names the source that authoritatively advances it
(a receipt, a re-read, a user action) — the same discipline as the freshness
precedence above.

## How to use it

**"Who reads X?"** — open the key's entry; `readers` is the answer, with each
module's role. `functions/INDEX.md` carries the same list in a single table, plus
the inverse: what one module touches, and how much `projection` state it is exposed
to.

**These lists are hand-written, and nothing verifies them against `web/`.** The
generator validates entry *shape* — trust domains, required fields, duplicates — and
never opens a source file, so a missing reader is invisible to `--check` and to the
presence gate. Grep the repo before treating a `readers` list as exhaustive, and add
what you find. A key whose list is wrong is worse than no key, because it answers the
blast-radius question confidently.

**"What is safe to change?"** — a `pure-client` key whose `writers` **and** `readers`
all sit in one file is local. Readers alone are not the test: `markets.active-mode`
has a single reader but three writers across three components, and treating it as
local is how the action overlay gets broken from a surface that looked unrelated.

A key touched by more than one component file, or by any hook or `web/lib/` module,
is not local — hooks and `lib/` belong to no single region, so any key they touch
crosses regions by default. Nor is any `projection` key: check the fail-closed notes
before changing what a non-`ready` status renders.

**A key names a meaning, not one React cell.** Several writers can be independent
per-flow instances of the same meaning rather than writers to a shared cell —
`action.amount-raw` is four separate `useState` values in `SupplyFlow`, `BorrowFlow`,
`RepayFlow`, and `ConvertFlow`, plus a clearing hook. Read the writer roles before
assuming shared mutable state; a refactor that hoists them into one context because
the table said "5 writers" would be changing behaviour, not tidying it.

**Before editing Markets UI** — list the keys you will read or write and their
dependent modules, per the charter's step 2 (`../README.md`).

## Sources the catalog is built from

- The mechanism map in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
- Eight region briefs in `docs/maps/ui/`
- `web/lib/discovery/` — stream-candidate projection boundary
- `web/lib/read-outcome.ts` — the four-status outcome shape projections resolve to
- Landing modules in U4–U11 (kit, lib, hooks, watch, flows) — catalogued before those files exist
- Incumbent executor / query / invalidation modules that U6 re-anchors
