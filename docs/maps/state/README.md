# Client state map — index

The catalog of **client** UI state for the Markets app: React state and machines,
query/wagmi/executor state, and the facts the UI displays. It exists so an agent can
answer *"what state do I touch, and who depends on it?"* before editing.

**This is not the Solidity state map.** `x-ray/` remains the authority for on-chain
entry points and contract state. This catalog covers the browser.

**No keys are catalogued yet.** This index is the day-one stub; populating the
catalog is a separate unit. Do not hand-write keys inline while doing other work.

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

## Minimum fields per key

From `../SCHEMAS.md` §3 — the shape briefs and review lenses read:

| Field | What it must answer |
|---|---|
| `key` | Stable state-key identifier |
| `trust_domain` | `on-chain` · `projection` · `pure-client` |
| `writers` | Every module/hook that sets it |
| `readers` | Every module/hook that consumes it |

## Trust domains, briefly

Full rules in `../SCHEMAS.md` §2. The load-bearing part:

- `on-chain` is authoritative. **Anything gating an action must be this.**
- `projection` is a candidate set — it narrows *which ids to ask about* and decides
  nothing.
- `pure-client` never stands in for chain truth.

Moving a fact between domains, or letting a `projection` value feed a gate, is a
trust-domain change: summary ADR required, and it escalates to the Owner
(`../REVIEW.md`).

## Sources the catalog is built from

- `web/hooks/` — the hooks that read and write client state
- `web/lib/query-keys.ts` — query key surface
- `web/lib/discovery/` — projection boundary, and where `projection` stops
- `web/components/action-flow/` — executor and transaction-queue state
