# OVRFLO Maps — AI-first operating charter

This is the operating charter for changing **OVRFLO Markets UI/UX**. It exists so a
coding agent opening a fresh checkout can declare blast radius and durable rationale
without inventing process.

Solidity already has an entry→state map and a process to keep it honest (`x-ray/`).
This is the client-side equivalent for the web app. **The two are separate systems.**
`x-ray/` remains the authority for on-chain state; nothing here replaces or subsumes it.

The human is **Owner/operator**, not the default reviewer. Routine changes are
reviewed by agents, through the `ce-code-review` and `ce-doc-review` skills — see
`REVIEW.md` for which one runs when. The Owner sets goals and handles the five
escalation triggers — nothing else.

---

## Authority order

When two sources disagree about a change, the higher one wins:

1. **Product truth** — `PRODUCT.md`, `CONCEPTS.md`
2. **UI region briefs** — `docs/maps/ui/` (meaning, control contracts)
3. **Gherkin** — `web/tests/e2e/*.feature` (flow-level behavior)
4. **`DESIGN.md` / Impeccable comps** — visual system
5. **Code** — `web/`

Two rules make this operational:

- **Comps win on pixels; briefs win on meaning.** A comp may not redefine what a
  control does, when it is visible, or which data authority backs it.
- **Comps may contain generative noise. Never ship it as product behavior.** OVRFLO
  has no health factors and no liquidations. A number, badge, or gauge that appears
  in a comp but has no product truth behind it does not enter the product.

Code is last on purpose. Code that contradicts a brief is a defect in the code, not
an amendment to the brief.

## The six Markets regions

Region briefs live in `docs/maps/ui/` and are the meaning layer for the Markets app.
There are six, and only six, at pass 1:

| # | Region | Incumbent code |
|---|---|---|
| 1 | Header | `web/components/MarketsApp.tsx` |
| 2 | Your positions | `web/components/PositionSummary.tsx` · `web/components/PositionList.tsx` |
| 3 | Self-repaying markets table | `web/components/MarketsTable.tsx` · `web/components/RateLadder.tsx` |
| 4 | Expanded settlement | `web/components/MarketRowDetail.tsx` · `web/components/MarketDetail.tsx` |
| 5 | Action modal / overlay | `web/components/ActionModal.tsx` · `web/components/ClaimAllModal.tsx` · `web/components/action-flow/` |
| 6 | System chrome | `web/components/Providers.tsx` · `web/components/WalletRuntime.tsx` · `web/components/ModalErrorBoundary.tsx` · `web/components/TruncationNotice.tsx` |

Each region documents its controls against the seven mandatory fields in
`SCHEMAS.md`. Regions are region-level documents with **nested controls** — not one
file per control.

## Client state

`docs/maps/state/` catalogs **client** UI state: React/machines, query/wagmi/executor,
and the facts the UI displays. Every displayed fact carries a **trust domain**
(`on-chain` / `projection` / `pure-client`) — see `SCHEMAS.md`.

State keys are the source of truth. The function/module index is **generated** from
the keys, never hand-maintained alongside them.

## Fill order

```
charter (this) ──┬── ui region briefs ──┬── coding standard
                 │                      └── stack fitness
                 ├── state keys ────────────┘
                 ├── testing map + accountability
                 └── ADR + scratch decisions
                              │
                              └── presence gate (needs charter + briefs + keys)
```

Current state of the fill:

| Artifact | Status |
|---|---|
| `README.md`, `SCHEMAS.md`, `REVIEW.md` | published |
| `docs/adr/README.md` | published |
| `.scratch/decisions/` process | published — local only, see `SCHEMAS.md` §4 |
| `docs/maps/ui/` region briefs | index only — bodies not yet written |
| `docs/maps/state/` keys + generated index | stub only — no keys yet |
| `CODING_STANDARD.md` | not yet extracted |
| `STACK_FITNESS.md` | not yet written |
| Presence gate | not yet wired |

An artifact marked *stub* or *not yet* is **not** an invitation to invent its
contents inline. It means a later unit owns it.

## What an agent does before editing Markets UI

1. Read the region brief for the surface you are touching (`docs/maps/ui/`).
2. Read the state keys you will read or write (`docs/maps/state/`), and list the
   dependent readers/writers.
3. Implement.
4. If ownership, trust domain, or a key technical decision moved: write the summary
   ADR (rules in `docs/adr/README.md`) and the scratch YAML (schema in `SCHEMAS.md`
   §4 — that is the normative source; `.scratch/` is untracked and may be absent).
5. Run agent review — `ce-code-review` for code, `ce-doc-review` for documents
   (`REVIEW.md`). Merge on a clean verdict.

If a brief or state key you need does not exist yet, that is a gap to report — not a
blank cheque to guess. Say what is missing.

## Reused, not duplicated

This charter deliberately does **not** restate rules that already have an owner:

| Concern | Owner — do not fork it |
|---|---|
| Frontend conventions and audit standing | `docs/frontend-decision-map.md` |
| Web test catalog | `web/reviews/testing.md` |
| Test-change accountability | `web/reviews/test-accountability.md` |
| Code-quality review stance | `web/reviews/coding.md` |
| Mechanical bans | `web/scripts/check-banned-patterns.sh`, `web/tests/scripts/banned-patterns.test.ts` |
| Enforceable protocol rules | `docs/solutions/patterns/ovrflo-critical-patterns.md` |
| Solved-problem writeups | `docs/solutions/` |
| On-chain state authority | `x-ray/` |

When a rule can be enforced mechanically by one of the above, extend that mechanism
rather than adding prose here.

## Out of scope for the Maps system

- **Clearing Ledger visual redesign implementation** — deferred consumer of these
  maps (`docs/plans/2026-07-31-002-feat-clearing-ledger-markets-visual-redesign-plan.md`)
- **Stack migration** — Next.js + React stands for this fill; `STACK_FITNESS.md`
  scores fitness for a later Owner-directed review and does not perform a switch
- **Replacing Solidity `x-ray/`** — on-chain state authority stays where it is
- **Mandatory human review of routine changes** — the point of the system is that
  agent review can accept or reject a change without the Owner

## Files

| Path | Purpose |
|---|---|
| `README.md` | this charter |
| `SCHEMAS.md` | normative control fields, trust domains, scratch YAML keys |
| `REVIEW.md` | which review skill runs when, review criteria, Owner escalation |
| `ui/README.md` | region brief index |
| `state/README.md` | client state catalog index |
| `../adr/README.md` | when a summary ADR is required |

`.scratch/` is untracked in its entirety, so scratch decision records — and their
local README and template — are **not in a fresh clone**. The normative scratch
schema is `SCHEMAS.md` §4, which is tracked. Write from that.
