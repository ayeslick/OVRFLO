---
title: "playwright-bdd's bddgen requires an object-destructuring first parameter on every step, even with no fixtures used"
date: 2026-07-27
category: integration-issues
module: web/tests/e2e
problem_type: integration_issue
component: testing_framework
symptoms:
  - "bddgen throws at generation time: `Error: First argument must use the object destructuring pattern: _fixtures async (_fixtures, ptAmount) => {...}`"
  - "The failure happens for `Given`/`When`/`Then` steps that take a Cucumber-expression argument (e.g. `{string}`) but don't need any Playwright fixture (no `page`, no custom fixture)"
  - "Writing the step as `async (_fixtures, arg) => {...}` (a normal unused-parameter convention) reproduces it; `async (arg) => {...}` (omitting the fixtures param entirely) also reproduces it once a fixture is later added back for a sibling step in the same describe block"
root_cause: wrong_api
resolution_type: code_fix
severity: low
tags: [playwright-bdd, bddgen, gherkin, e2e, cucumber-expressions, eslint]
---

# playwright-bdd's bddgen requires an object-destructuring first parameter on every step, even with no fixtures used

## Problem

`playwright-bdd`'s `bddgen` (the codegen step that turns `.feature` files into native Playwright tests) inspects
each step function's *source text* at generation time to figure out which fixtures it needs. That inspection
requires the first parameter to literally be an object-destructuring pattern — `{ page }`, `{ page, request }`,
or even empty `{}` — regardless of whether the step needs any fixtures at all. A step written with an ordinary
named-but-unused parameter fails `bddgen`, not TypeScript or ESLint.

## Symptoms

- `npx bddgen` (or `npm run test:e2e`, which runs it as a pretest step) throws:
  ```
  Error: First argument must use the object destructuring pattern: _fixtures async (_fixtures, ptAmount) => {
    const deployment = (0, _chain.readDeployment)();
    ...
  }
      at innerFixtureParameterNames (.../playwright-bdd/src/playwright/fixtureParameterNames.ts:25:11)
  ```
- `tsc --noEmit` and `eslint` both pass cleanly on the same file — this is a `bddgen`-specific static-analysis
  requirement, not a language or lint-rule violation, so the usual "fix what the toolchain complains about" loop
  doesn't catch it until `bddgen` itself runs.

## What Didn't Work

- `async (_fixtures, ptAmount: string) => {...}` — a normal "I don't use this parameter" convention in
  TypeScript/JS. `bddgen`'s check is purely syntactic (does the first parameter's AST node look like an
  `ObjectPattern`?), so a named identifier fails even though it's semantically equivalent to not using the
  fixtures object at all.

## Solution

Use an empty object-destructuring pattern, `{}`, as the first parameter instead of a named-but-unused one:

```typescript
// Fails bddgen: "First argument must use the object destructuring pattern"
Given("the wrap reserve holds {string}", async (_fixtures, underlyingAmount: string) => {
  await wrapUnderlying({ account: DEV_WALLET_ADDRESS, ovrflo: deployment.ovrflo, amount });
});

// Passes bddgen
// eslint-disable-next-line no-empty-pattern -- playwright-bdd requires the object-destructuring form for its first argument, even with no fixtures used.
Given("the wrap reserve holds {string}", async ({}, underlyingAmount: string) => {
  await wrapUnderlying({ account: DEV_WALLET_ADDRESS, ovrflo: deployment.ovrflo, amount });
});
```

Plain `{}` in turn trips ESLint's `no-empty-pattern` rule, so pair it with a scoped
`eslint-disable-next-line no-empty-pattern` comment rather than disabling the rule project-wide — the empty
pattern is a real, load-bearing requirement of this one third-party tool, not sloppiness worth silencing broadly.

## Why This Works

`bddgen` needs to know, ahead of actually running a test, which Playwright fixtures each step consumes so it can
generate a `test(..., async ({ page, ... }) => { ... })` wrapper with the right fixture set wired in. Rather than
executing the step function or relying on type information, it does this via **source-level static analysis**
of the function's first-parameter AST node (see `node_modules/playwright-bdd/src/playwright/fixtureParameterNames.ts`,
`innerFixtureParameterNames` — a third-party dependency path, not part of this repo's own tracked tree, so it
won't resolve via `git`/`gh`; confirmed present in the installed `playwright-bdd` package at the time of writing).
A destructuring pattern's property names are the fixture names it can extract
without ambiguity; a plain identifier parameter (fixture object bound to one name) isn't a shape the extractor
handles, even though it's valid, equivalent JavaScript. This makes the requirement a `bddgen`-specific contract,
not a general TypeScript/Playwright one — `page.test()` itself has no such restriction.

## Prevention

- When writing a step function that needs no fixtures, always use `{}` as the first parameter (with the
  `no-empty-pattern` disable comment), never a named identifier — even one prefixed with `_` per this repo's own
  `argsIgnorePattern: "^_"` ESLint convention for genuinely unused parameters elsewhere.
- After adding or editing any step file under `web/tests/e2e/steps/` or `web/tests/e2e/fixtures/`, run
  `npx bddgen` (or `npx playwright test --list`, which runs it implicitly) before trusting `tsc`/`eslint` alone —
  neither one will catch this class of failure.
- A related, unrelated-root-cause gotcha discovered in the same session: `playwright.config.ts`'s
  `defineBddConfig` defaults its generated-test output to `<project-root>/.features-gen/`, not
  `<project-root>/tests/e2e/.features-gen/` — a plausible-looking guess if writing the `.gitignore` entry from
  memory rather than checking where the directory actually lands. Verify the real output path (or read it from
  `playwright.config.ts`'s own comments) before writing `.gitignore`/ESLint `ignores` entries for it, rather than
  inferring it from the `features:`/`steps:` glob paths.

## Related Issues

- `docs/solutions/architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md` —
  same `playwright-bdd` E2E effort (Ticket 01), different concern (worker isolation, not step-function shape)
