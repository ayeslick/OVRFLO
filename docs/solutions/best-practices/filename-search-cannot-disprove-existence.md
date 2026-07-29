---
title: Filename search cannot disprove a symbol's existence
date: 2026-07-29
category: best-practices
module: web/components, codebase navigation
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - About to state that a component, hook, or function does not exist
  - Orienting in web/ where several components share one file
  - Deciding to create a symbol because a search suggested none exists
tags: [search, grep, negative-claims, codebase-navigation, colocation, web]
---

# Filename search cannot disprove a symbol's existence

## Context

Asked which audit findings applied to a particular form, the answer given was
"there is no `ConvertForm` component." The search behind that claim was
`find -iname`, which matches **file names only**. `ConvertForm` exists — it is
defined at `web/components/ActionModal.tsx:653`.

This is not an isolated near-miss. `web/components/` holds 14 files, and
`ActionModal.tsx` alone defines six form components — `SupplyForm`,
`SimpleActionForm`, `ConvertForm`, `BorrowForm`, `AdjustRateForm`, `RepayForm`
— plus a dozen presentational helpers such as `FormBody`, `AmountInput`,
`WrongNetworkNotice`, and `StepIndicator`. In this codebase, **most components
do not have a file named after them.**

## Guidance

**A claim that something does not exist requires a content search. A filename
search can only confirm existence, never absence.**

Search by definition site, not by file name:

```bash
# Wrong — answers "is there a file called this?"
find web -iname '*ConvertForm*'

# Right — answers "is this symbol defined anywhere?"
grep -rn "function ConvertForm\|const ConvertForm" web/
```

Two supporting habits:

- **Grade your confidence by the search you actually ran.** If the only
  evidence is a filename glob, the honest statement is "I did not find a file
  for it," not "it does not exist." The two differ by an entire class of
  colocated code.
- **Before creating a symbol because none was found**, run the content search.
  Creating a second `ConvertForm` beside an existing one is the expensive
  version of this mistake.

## Why This Matters

Negative existence claims are the most load-bearing and least-verified
statements in a code conversation. A positive claim ("it's at line 653") is
self-checking — the reader clicks it and it is either there or not. A negative
claim ("there is no such component") is unfalsifiable from the reader's side
without redoing the search, so it is taken on trust and then acted on: findings
get dismissed as inapplicable, duplicate code gets written, refactors scope
themselves around a component they believe is absent.

The failure is structural rather than careless. A filename search returning
nothing is *indistinguishable* from a correct negative — the tool gives the
same empty output either way, so there is no signal prompting a second look.
Only knowing the tool's scope prevents it.

## When to Apply

- Any sentence of the form "there is no X" / "X doesn't exist" / "nothing does Y"
- Answering questions about which findings, requirements, or tickets apply to a component
- Scoping a refactor by enumerating what exists in an area

## Examples

**The colocation that defeats filename search** — six form components in one file:

```
web/components/ActionModal.tsx
  355  SupplyForm
  536  SimpleActionForm
  653  ConvertForm
  911  BorrowForm
 1337  AdjustRateForm
 1578  RepayForm
```

**A search that answers the actual question**, covering both declaration forms
and any re-export:

```bash
grep -rn "ConvertForm" web/ --include=*.ts --include=*.tsx
```

## Related

- [Post-refactor dead code](../developer-experience/post-refactor-dead-code-WebUI-20260421.md) — the inverse error, believing something is live because a name survives
- [Vary one thing before blaming your own change for a flake](./vary-one-thing-before-blaming-your-own-change-for-a-flake.md) — the same discipline applied to causal claims rather than existence claims
