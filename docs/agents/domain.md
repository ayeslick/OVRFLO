# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/agents/system.md`** holds the column tower, the live vs target split, and the hop table.
- **`CONCEPTS.md`** is the shared domain vocabulary. This repo has no `CONTEXT.md`. Do not create one as a twin glossary.
- **`docs/adr/`** — ADRs that touch the area you are about to work in.

Protocol briefing for live `src/` is `docs/agents/onboarding.md`.

## File structure

Single-context repo (this repo):

```
/
├── CONCEPTS.md
├── PRODUCT.md
├── DESIGN.md
├── docs/agents/system.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONCEPTS.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
