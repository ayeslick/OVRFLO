---
title: Prefer battle-tested libraries and framework/runtime primitives over hand-rolled reimplementations
category: best-practices
module: web/
date: 2026-07-27
problem_type: best_practice
component: nextjs_react
severity: medium
applies_when:
  - "Writing new logic for something that is a common, well-solved problem (deep clone/merge, debounce/throttle, date/time formatting, URL/query-string parsing, retry/backoff, focus trapping, clipboard access, UUID/id generation, deep equality)"
  - "Reviewing a diff and noticing a loop, helper, or state machine that reimplements something the language stdlib, the framework (React/Next.js), or an already-installed dependency already provides"
  - "Deciding whether to write a new utility function versus reaching for an existing import"
tags: [code-reuse, hand-rolled, stdlib, dependencies, react, nextjs, simplification, web]
---

# Prefer battle-tested libraries and framework/runtime primitives over hand-rolled reimplementations

## Context

During a 2026-07-27 simplification pass over `web/*` (`/ce-simplify-code`), the
code-reuse review surfaced the general pattern this doc formalizes: hand-rolled
logic for problems that already have a correct, tested solution one import
away. The concrete finding in that pass was two independent hand-rolled
wall-clock hooks in `MarketRowDetail.tsx` and `MarketsTable.tsx`
(`useState<bigint | null>(null)` + `useEffect(() => setNowSeconds(...), [])`)
duplicating the already-extracted `web/hooks/useNowSeconds.ts`. Fixing that one
duplication surfaced a second-order lesson — see
[`docs/solutions/architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md`](../architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md)
— but the first-order lesson is simpler and worth stating as a standing rule:
**check for an existing utility, library function, or framework primitive
before writing a new implementation of a common problem.**

This is not specific to that one hook. The same failure mode shows up as:

- A hand-written deep-equality or deep-clone loop where `structuredClone`, a
  small existing utility, or an already-installed library (e.g. a dependency
  already in `package.json`) does the same thing correctly for every edge
  case (cycles, `Map`/`Set`, `Date`, etc.).
- Manual debounce/throttle timers hand-rolled with `setTimeout` where the
  codebase (or a tiny, well-known dependency) already has one.
- Ad-hoc date/number formatting with string concatenation where `Intl.*` or
  an existing `web/lib/format.ts` helper already exists in this codebase.
- A hand-rolled focus trap, click-outside handler, or portal implementation
  when one is already extracted (this codebase has `useFocusTrap` —
  `web/hooks/useFocusTrap.ts` — for exactly this).
- Re-parsing query strings or URLs by hand instead of `URL`/`URLSearchParams`.
- A hand-written retry/backoff loop for a network call where `viem`/`wagmi`
  or `@tanstack/react-query` already retries with configurable backoff.

## Guidance

Before writing new logic for a problem that is not specific to this
protocol's domain (Pendle/Sablier/OVRFLO business logic), check in order:

1. **This codebase.** Search `web/hooks/`, `web/lib/`, and sibling components
   for an existing helper. If one exists but doesn't quite fit every call
   site, prefer extending it (see the render-tree-position doc above for an
   example of extending rather than forcing a single shape) over duplicating
   it.
2. **The language/runtime stdlib.** `structuredClone`, `Intl`, `URL`,
   `Array`/`Object`/`Map`/`Set` methods, `AbortController`, etc. These are
   correct for every edge case a hand-rolled version would need years to
   discover (cycles, locale, unicode, timezone).
3. **Already-installed dependencies.** `viem`, `wagmi`, `@tanstack/react-query`,
   `next` — check whether the framework/library already solves the problem
   (caching, retries, focus management, routing) before adding logic on top
   of it. Do not add a *new* dependency for a one-line problem; this step is
   about not re-solving what an existing dependency already handles.
4. **Only then, write new code**, and only if the problem is genuinely
   protocol-specific (there is no generic library for "compute a Sablier
   stream's obligation" — that belongs in `StreamPricing`/`lib/*`, hand-rolled
   and owned).

**This is a behavior-preservation-first rule, not a line-count-first rule.**
Swapping to an existing utility or stdlib primitive is only a simplification
if it is behavior-equivalent for every input actually in play — see the
code-reuse reviewer's guardrails (`~/.claude/plugins/.../code-reuse-reviewer.md`):
do not swap in a native UI control, a locale-dependent formatter, or a
different sort-stability/serialization behavior than what is already relied
upon, even when it would technically "reuse" something existing. When in
doubt, keep the current behavior and note the tradeoff rather than force a
reuse.

## Why This Matters

- **Hand-rolled reimplementations accumulate silent edge-case bugs.** A
  wall-clock `useState`+`useEffect` pair looks trivial, but as the companion
  doc shows, the "trivial" version still had a real hydration-safety
  precondition that only became visible once two independent copies were
  compared side by side.
- **Duplication compounds review cost.** Every hand-rolled copy is a second
  (or third) place a future bug fix has to be applied; consolidating to one
  reviewed implementation means a fix in one place fixes every call site.
- **Battle-tested code has already paid the edge-case tax.** stdlib and
  well-known framework primitives have been exercised against far more edge
  cases (locale, timezone, cycles, unicode, concurrent access) than a
  one-off implementation written for a single call site ever will be.

## When to Apply

- Any time new logic is being written for a problem that is not
  protocol-specific domain logic (Pendle/Sablier/OVRFLO math and state).
- During code review or a simplification pass (`/ce-simplify-code`), flag any
  diff that reimplements something the stdlib, framework, or an existing
  in-repo utility already provides — see the code-reuse reviewer persona
  criteria for the exact bar (must be behavior-equivalent for the inputs
  actually in play, not just superficially similar).

## Related

- [`docs/solutions/architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md`](../architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md) — the second-order lesson from consolidating the `useNowSeconds` duplication that prompted this rule.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` pattern #20.
