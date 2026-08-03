# Maps schemas (normative)

Region briefs, state entries, and scratch decision files **must** validate against
the schemas below. These are the field names other artifacts are checked against —
do not rename them locally, and do not add a parallel vocabulary.

Charter: `README.md`. Review contract: `REVIEW.md`.

---

## 1. Control schema — seven mandatory fields

Every control documented in a region brief (`docs/maps/ui/`) carries all seven. A
control missing any field is not documented.

| # | Field | What it must answer |
|---|---|---|
| 1 | **ID** | Stable identifier for this control (format below) |
| 2 | **Purpose** | What the user is trying to accomplish here, in product terms |
| 3 | **Visible when** | The exact condition under which this control renders at all |
| 4 | **States** | Every state it can occupy, named and distinguishable |
| 5 | **Action** | What happens on activation, including the on-chain consequence |
| 6 | **Copy rules** | What the text must and must not say |
| 7 | **Data authority** | Which trust domain backs each fact this control shows (§2) |

Optional at pass 1 — add them when known, never as a substitute for the seven:
a11y notes, color/token references, links to covering tests.

### Control ID format

```
UI-<REGION>-<CONTROL>
```

`<REGION>` is one of the six fixed region slugs; `<CONTROL>` is a hyphenated slug
unique within its region. Uppercase, hyphen-separated, no spaces.

| Region | Slug |
|---|---|
| Header | `HEADER` |
| Your positions | `POSITIONS` |
| Self-repaying markets table | `MARKETS-TABLE` |
| Expanded settlement | `SETTLEMENT` |
| Action modal / overlay | `ACTION` |
| System chrome | `CHROME` |

Example: `UI-MARKETS-TABLE-BORROW`.

Gherkin stays **flow-level** and references controls by tag — one scenario per flow,
tagged with the controls it exercises. It is not one scenario per control.

```gherkin
@UI-MARKETS-TABLE-BORROW @UI-ACTION-CONFIRM
Scenario: Borrower pledges a stream against standing liquidity
```

### States must stay distinguishable

`States` exists to stop states from collapsing into each other. Loading, stale,
unavailable, failed, and empty are **five different things** and must never share a
representation — a confident empty result standing in for "could not ask" is the
failure this field is here to prevent (`PRODUCT.md` principle 5; see
`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`).

---

## 2. Trust domains

Every displayed fact and every state key carries exactly one:

| Domain | Meaning | Rule |
|---|---|---|
| `on-chain` | Read directly from a contract or Sablier | Authoritative. Anything gating an action must be this. |
| `projection` | Derived from browser-side log projection / discovery | A **candidate set**, never an authority. May narrow what to ask about; may never decide what is allowed. |
| `pure-client` | Exists only in the browser — form input, UI toggle, optimistic view | Never presented as chain truth. |

Two rules follow, and both are review-blocking (`REVIEW.md`, state-and-trust
criteria):

- **A field that reaches an `if (…) allow` is re-read from the authority.** Wrong
  display data misleads; wrong gate data authorizes.
- **Promoting a fact from `projection` to `on-chain` — or letting a projection value
  feed a gate — is a trust-domain change.** It requires a summary ADR and escalates
  to the Owner.

---

## 3. State entry — minimum shape

Full catalog design belongs to the state-map unit; these fields are the minimum any
entry under `docs/maps/state/keys/` must carry, because briefs and reviews read them:

| Field | What it must answer |
|---|---|
| `key` | Stable state-key identifier |
| `trust_domain` | One of §2 |
| `writers` | Every module/hook that sets it |
| `readers` | Every module/hook that consumes it |

**Keys are the source of truth. The function/module index is generated from them.**
Never hand-maintain a second index alongside the keys — a hand-copied index drifts
and then lies about blast radius.

---

## 4. Scratch decision YAML

One file per state-touching change that needs deep audit context, under
`.scratch/decisions/`. All nine keys are required; use an empty list rather than
omitting a key.

| Key | Type | Contents |
|---|---|---|
| `summary_ref` | string | Path to the summary ADR, or the PR reference when no ADR was required |
| `goal` | string | What this change is for, in one or two sentences |
| `state_keys_touched` | list | State keys read or written (§3) |
| `writers_readers` | list | Modules that write or read those keys — the blast radius |
| `trust_domains` | list | Trust domain per touched fact, and any domain that moved (§2) |
| `rejected_alternatives` | list | Approaches considered and why they lost |
| `invariants_held` | list | Invariants this change preserves, and how |
| `risks` | list | What could still go wrong, and the residual exposure |
| `diff_hints` | list | Where a reviewer should look first |

**This section is the normative source.** `.scratch/` is untracked in its entirety,
so a fresh clone has no template and no local README — write the file from the table
above. `.scratch/decisions/template.yaml` and `.scratch/decisions/README.md` are
local conveniences that may or may not be present; if they disagree with this
section, this section wins.

Scratch is **AI-first**. It is structured context for a review agent, not a human
essay — terse fields beat prose. The durable, tracked record is the summary ADR;
scratch carries the depth behind it.
