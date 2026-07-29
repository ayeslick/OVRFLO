---
title: The agent instruction files are gitignored — check tracking before making a file canonical
date: 2026-07-29
category: developer-experience
module: repo root, .gitignore
problem_type: developer_experience
component: documentation
severity: high
applies_when:
  - Writing durable guidance intended for future agents or collaborators
  - Choosing where an index, checklist, or distilled rule set should live
  - Editing AGENTS.md, CLAUDE.md, BASE_SECURITY.md, or VAULT_SECURITY.md
tags: [gitignore, agents-md, documentation, knowledge-store, tracked-files]
---

# The agent instruction files are gitignored — check tracking before making a file canonical

## Context

While remediating the 2026-07-28 audit, requirement R4 called for a
settled-findings index that future reviewers would hit before re-raising a
disproven finding. The obvious home was `AGENTS.md` — it is the file every
agent reads first.

`AGENTS.md` is gitignored. So are the other three:

```
$ git check-ignore -v AGENTS.md CLAUDE.md BASE_SECURITY.md VAULT_SECURITY.md
.gitignore:73:AGENTS.md          AGENTS.md
.gitignore:72:CLAUDE.md          CLAUDE.md
.gitignore:71:BASE_SECURITY.md   BASE_SECURITY.md
.gitignore:69:VAULT_SECURITY.md  VAULT_SECURITY.md
```

An index written into any of them would have reached exactly one machine. It
would also have *appeared* to work indefinitely: the local agent reads the file
and behaves correctly, so nothing surfaces the fact that no one else has it.

## Guidance

**Before writing durable knowledge into a file, confirm the file is tracked.**

```bash
git ls-files --error-unmatch <path> >/dev/null 2>&1 && echo tracked || echo NOT-TRACKED
```

For this repo specifically:

| File | Tracked | Use for |
|------|---------|---------|
| `AGENTS.md`, `CLAUDE.md` | **no** | local, machine-specific agent configuration |
| `BASE_SECURITY.md`, `VAULT_SECURITY.md` | **no** | local security guidance |
| `CONCEPTS.md` | yes | shared domain vocabulary |
| `README.md`, `docs/**` | yes | everything meant to be shared |

The tracked home for distilled, enforceable rules is
`docs/solutions/patterns/ovrflo-critical-patterns.md`. The tracked home for
worked evidence is `docs/audit/` and `docs/solutions/`. `AGENTS.md` can *point*
at those — a pointer that only exists locally still costs nothing — but it must
not be the only copy of anything.

## Why This Matters

This failure is silent in both directions, which is what makes it worth a
document rather than a mental note.

Writing to a gitignored file produces no error, no warning, and no diff to
notice in review. `git status` stays clean — which reads as "nothing to commit"
rather than "your change is invisible." The knowledge appears to land, and the
authoring agent's own subsequent behavior confirms it, because that agent reads
the same local file.

The inverse trap is just as quiet: an agent that reads `AGENTS.md` and finds a
rule cannot tell whether that rule is a shared project convention or one
developer's local preference. Anything load-bearing therefore needs a tracked
source that `AGENTS.md` defers to, so the two can never disagree about what the
project actually requires.

## When to Apply

- Adding an index, checklist, or "read this before X" section for future agents
- Any time a plan requirement says "record it in the instruction file"
- Distilling a rule that other reviewers or contributors are expected to follow
- Before assuming a repo-root markdown file is shared — check, do not infer from
  the filename

## Examples

**What R4 nearly did** — an index of settled findings written where only one
machine would see it:

```bash
# AGENTS.md is gitignored; this edit ships nowhere
$ git status --short AGENTS.md
$   # (empty — and that emptiness is the bug, not the all-clear)
```

**What it does instead** — the enumerated disproofs live in the tracked
patterns file, and the local instruction file points at them. Both readers are
served, and only one copy is authoritative.

## Related

- [Record rejected findings with rationale](../best-practices/record-rejected-findings-with-rationale.md) — the index this discovery relocated, and why a link alone was not enough
- [patterns/ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md) — the tracked home for distilled enforceable rules
- [Living docs debt after protocol function removal](../documentation-gaps/living-docs-debt-after-protocol-function-removal.md) — the adjacent failure of tracked docs drifting from the code
