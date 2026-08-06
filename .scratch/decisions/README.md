# Scratch decisions

AI-optimized decision records: the deep context behind a change, in a fixed YAML
shape a review agent can parse.

`.scratch/` is **tracked** as of 2026-08-06 (it was previously gitignored; the Owner
un-ignored it). The durable, self-standing record is still the summary ADR in
`docs/adr/`. Scratch carries the depth; the ADR carries the decision.

Schema: `docs/maps/SCHEMAS.md` §4. Template: `template.yaml`.

---

## When to write one

For a **state-touching change that needs deep audit context** — anything where a
reviewer will have to reconstruct blast radius, rejected alternatives, or which
invariants survived. In practice this is every change that:

- reads or writes state keys beyond the one surface it edits, or
- moves a fact between trust domains, or
- accepts an exception to a mapped invariant.

Ordinary work inside an existing brief does not need one.

## How it is written

- **AI-first.** Terse structured fields beat prose. A review agent reads this; it is
  not a human essay and nobody has to write one.
- All nine keys are required. Use an empty list rather than dropping a key — an
  absent key is indistinguishable from an unanswered question.
- `summary_ref` points at the tracked record: the ADR path when one was required,
  otherwise the PR reference.

## Naming

```
.scratch/decisions/YYYY-MM-DD-short-kebab-slug.yaml
```

## Tracked, but not authoritative

`.scratch/` travels with the repo since 2026-08-06, this README and `template.yaml`
included. The **normative schema still lives in `docs/maps/SCHEMAS.md` §4**, not in
this directory: `template.yaml` is a convenience copy, and if the two ever disagree,
SCHEMAS wins.

The presence gate's contract is unchanged: it requires the summary ADR, never a
scratch file, and reads the ADR's `Scratch:` pointer as the link into this
directory. Keep that pointer accurate.

If a specific decision's context deserves durable prose, still promote it — write
the ADR, or a `docs/solutions/` entry once the outcome is known. Scratch being
tracked makes it visible history; it does not make it the record of note.
