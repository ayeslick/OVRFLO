# State keys — source of truth

Every entry in this directory is a **client** state key: something the Markets app
holds, derives, or displays in the browser. These files are the source of truth.
`../functions/INDEX.md` is generated from them and must never be edited by hand.

**This is not the Solidity state map.** `x-ray/` remains the authority for on-chain
entry points and contract state. Nothing here covers, mirrors, or replaces it. A key
whose `trust_domain` is `on-chain` describes *the browser's copy of* a chain fact and
who depends on that copy — the contract-side truth lives in `x-ray/`.

## Files

| File | Contents |
|---|---|
| `view-state.md` | Selection, expansion, and overlay state — what the user is looking at |
| `form-state.md` | Action-form input and per-form guard state |
| `execution-state.md` | Executor phase, write-flow, and Claim All queue latches |
| `chain-reads.md` | The browser's copies of chain facts, and the query keys that hold them |
| `projection.md` | Browser-side log projection — candidate sets, never authorities |

## Entry format

The generator parses these files. The shape is strict; a malformed entry fails the
run rather than being silently skipped.

```markdown
### `namespace.key-name`

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/Example.tsx` — how it sets the value
- **readers:**
  - `web/components/Other.tsx` — what it does with the value
- **notes:** anything a reviewer needs that the four fields do not carry
```

Rules the parser enforces:

- The heading is `###` with the key in backticks, and the key is unique catalog-wide.
- `trust_domain` is exactly one of `on-chain` · `projection` · `pure-client`
  (`../../SCHEMAS.md` §2).
- `writers` and `readers` are non-empty lists. Each member is a two-space-indented
  bullet whose first token is a backticked repo-relative path, optionally followed by
  ` — ` and a one-line role.
- `notes` is free text and is not parsed. Fail-closed guidance, gate warnings, and
  dead-code caveats go here.

The four parsed fields are exactly `../../SCHEMAS.md` §3. `notes` carries everything
else so the machine-readable core stays small.

## Naming

`namespace.key-name` — lowercase, dot-separated namespace, hyphenated leaf. The
namespace groups by surface (`markets.`, `positions.`, `action.`, `queue.`,
`executor.`, `chain.`, `projection.`, `query.`), not by file.

Keys name **meaning**, not the React identifier. `positions.loaded-user` survives a
rename of `loadedUser`; a key named after the variable does not.

## What must be in a `projection` entry

Every `projection` key carries fail-closed guidance in `notes` — concretely, which
consumer distinguishes *empty* from *could not ask*, and which fields must never
reach a gate. `empty` and `unavailable` are different answers that lead to opposite
user actions, and a key entry that does not say so invites the collapse
(`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).

Promoting a fact from `projection` to `on-chain`, or letting a projection value feed
an `if (…) allow`, is a **trust-domain change**: summary ADR required, and it
escalates to the Owner (`../../REVIEW.md`).

## After editing a key

```sh
node tools/scripts/generate-state-function-index.mjs
```

`--check` verifies without writing and exits non-zero on drift.
