# Architecture Decision Records

Short, tracked summaries of decisions that moved something durable. An ADR is the
**record a reviewer and a mechanical gate can both see** — the deep context behind it
lives in `.scratch/decisions/` (`../maps/SCHEMAS.md` §4).

Keep them short. An ADR is a summary, not the analysis.

---

## When a summary ADR is required

Write one when the change moves any of these:

- **Ownership** — a module, hook, or state key changes who writes it or who is
  responsible for it
- **Trust domain** — a fact moves between `on-chain` / `projection` / `pure-client`,
  or a projection value starts feeding a gate (`../maps/SCHEMAS.md` §2). This also
  escalates to the Owner (`../maps/REVIEW.md`)
- **A key technical decision** — a decision recorded in a plan's Key Technical
  Decisions, or one that later work will have to live with
- **Authority order or product identity** — also an Owner escalation
- **An accepted exception to a mapped invariant**

## When a PR summary is enough

No ADR for the ordinary majority:

- Implementing an existing brief or plan unit as written
- Bug fixes that restore documented behavior
- Copy, styling, and layout inside existing `Copy rules`
- Test additions, and refactors with no ownership or trust-domain movement
- Dependency bumps with no architectural consequence

**If you are unsure, it is a PR summary.** An ADR for every change makes the set
worthless. What forces an ADR is *movement* — ownership, trust, or a decision later
work is stuck with.

## Format

One file per decision, numbered sequentially:

```
docs/adr/0001-short-kebab-title.md
```

```markdown
# ADR-0001 — Short title

Date: YYYY-MM-DD
Status: proposed | accepted | superseded by ADR-NNNN
Scratch: .scratch/decisions/<file>.yaml   # optional; local deep context

## Context
What forced a decision.

## Decision
What was decided, stated plainly.

## Consequences
What this makes easy, what it makes hard, and what later work inherits.
```

The `Scratch` line is the pointer to the scratch YAML. `.scratch/` is tracked as of
2026-08-06 (it was previously gitignored), but the contract is unchanged: the ADR
must stand on its own without the scratch file being read.

## Relationship to other records

| Record | Tracked | Holds |
|---|---|---|
| `docs/adr/` | yes | the decision and its consequences — short |
| `.scratch/decisions/` | yes, since 2026-08-06 | blast radius, rejected alternatives, invariants, risks |
| `docs/solutions/` | yes | writeups of solved problems, after the fact |
| `CONCEPTS.md` | yes | shared domain vocabulary |

An ADR records *what was decided*. A `docs/solutions/` entry records *what went wrong
and how it was fixed*. They are not substitutes.

## Conflicts

If your work contradicts an existing ADR, say so explicitly rather than silently
overriding it:

> _Contradicts ADR-0007 (…) — but worth reopening because…_

Superseding an ADR means writing a new one and marking the old one
`superseded by ADR-NNNN`. Do not edit a decision's history.
