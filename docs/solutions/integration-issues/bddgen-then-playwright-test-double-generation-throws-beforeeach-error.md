---
title: "Running bddgen as a separate step before playwright test throws \"did not expect test.beforeEach() to be called here\""
date: 2026-07-28
category: integration-issues
module: web/tests/e2e
problem_type: integration_issue
component: testing_framework
severity: low
symptoms:
  - "`npx bddgen && npx playwright test tests/e2e/<spec>.feature.spec.js -g \"<scenario>\"` (run as two separate commands) crashes Node before any test runs: `Error: Playwright Test did not expect test.beforeEach() to be called here.`"
  - "The crash's stack trace bottoms out in playwright-bdd's own generation internals (`TestFilesGenerator.generate` -> `loadSteps` -> `loadStepsFromFile` -> `requireOrImport`), not in this repo's own step/fixture code"
  - "Running `npx playwright test tests/e2e/<spec>.feature.spec.js -g \"<scenario>\"` alone (no separate prior `bddgen` invocation) works and passes normally"
root_cause: wrong_api
resolution_type: workflow_improvement
related_components: [web/tests/e2e/fixtures/bdd.ts, web/tests/e2e/fixtures/fork-snapshot.ts, web/playwright.config.ts]
tags: [playwright-bdd, bddgen, gherkin, e2e, test-generation]
---

# Running bddgen as a separate step before playwright test throws "did not expect test.beforeEach() to be called here"

## Problem

Invoking `bddgen` and `playwright test` as two separate commands in sequence — a reasonable-looking way to regenerate step bindings before running a single scenario by exact spec path — crashes with a Playwright internal error before any test executes, even though each command works fine on its own in the repo's documented `test:e2e` flow (`npm run pretest && bddgen && playwright test`, run as one `npm run` script rather than two ad hoc shell invocations).

## Symptoms

Running:
```bash
NEXT_PUBLIC_E2E=1 npx bddgen && NEXT_PUBLIC_E2E=1 npx playwright test tests/e2e/deposit-wrap-unwrap.feature.spec.js -g "unwrap ovrfloToken back into underlying"
```
throws:
```
Error: Playwright Test did not expect test.beforeEach() to be called here.
Most common reasons include:
- You are calling test.beforeEach() in a configuration file.
- You are calling test.beforeEach() in a file that is imported by the configuration file.
- You have two different versions of @playwright/test.
    at _TestTypeImpl._currentSuite (.../playwright/lib/common/index.js:2266:13)
    at _TestTypeImpl._hook (.../playwright/lib/common/index.js:2352:24)
    at Function.beforeEach (.../playwright/lib/common/index.js:1212:12)
    at Object.<anonymous> (/Users/jay/OVFL/web/tests/e2e/fixtures/bdd.ts:10:6)
    ...
    at loadStepsFromFile (.../playwright-bdd/src/steps/loader.ts:18:36)
    at loadSteps (.../playwright-bdd/src/steps/loader.ts:13:11)
    at TestFilesGenerator.loadSteps (.../playwright-bdd/src/generate/index.ts:73:20)
    at async Promise.all (index 1)
    at TestFilesGenerator.generate (.../playwright-bdd/src/generate/index.ts:32:5)
    at generateFilesForConfigs (.../playwright-bdd/src/cli/commands/test.ts:67:3)
```
The trace's file/line reference (`fixtures/bdd.ts:10:6`) is misleading taken at face value: the current source of `web/tests/e2e/fixtures/bdd.ts` is only 8 lines and contains no `test.beforeEach()` call anywhere (it's just `export const { Given, When, Then } = createBdd(test);`), and neither does `web/tests/e2e/fixtures/fork-snapshot.ts` (its only fixture is an `auto: true` `forkSnapshot` fixture, no hook). The `beforeEach` call the trace is complaining about is not written anywhere in this repo's own source.

## What Didn't Work

- Reading the trace literally and looking for a stray `test.beforeEach()` in `bdd.ts` or `fork-snapshot.ts` — there isn't one. Grepping this repo's `web/tests/e2e/fixtures/` and `web/tests/e2e/steps/` for `beforeEach` returns zero matches.
- Assuming this is the same known quirk as the sibling doc `playwright-bdd-bddgen-requires-object-destructuring-first-param.md` — it isn't. That doc's error is `First argument must use the object destructuring pattern`, a completely different message, thrown for a different reason (a step function's parameter shape), and it doesn't reproduce here regardless of invocation order.

## Solution

Skip the separate `bddgen` invocation entirely and run `playwright test` directly against the target spec, using `-g` to filter to one scenario:

```bash
NEXT_PUBLIC_E2E=1 npx playwright test tests/e2e/deposit-wrap-unwrap.feature.spec.js -g "unwrap ovrfloToken back into underlying"
```

This is also consistent with the repo's own documented flow: `package.json`'s `test:e2e` script is `npm run pretest && bddgen && playwright test` — `bddgen` and `playwright test` run there too, but as steps of a single `npm run` invocation rather than as two separately-invoked `npx` commands run back-to-back in the same shell line; in practice, simply omitting the standalone `bddgen` call and letting `playwright test` trigger generation itself avoids the crash.

## Why This Works

`web/playwright.config.ts` calls `defineBddConfig({...})` from `playwright-bdd` at module scope to compute `testDir`. This call triggers `playwright-bdd`'s own test-file generation as a side effect of Playwright resolving its config — so every `npx playwright test` invocation already regenerates `.features-gen/` from the current `.feature` files and step definitions before running anything, with no separate `bddgen` step required.

Every `.feature` file in this suite (`deposit-wrap-unwrap.feature` included) has a `Background:` block. `playwright-bdd`'s own generator — a third-party dependency path, not part of this repo's own tracked tree, so it won't resolve via `git`/`gh`; confirmed present in the installed `playwright-bdd` package at the time of writing, at `node_modules/playwright-bdd/dist/generate/formatter.js`'s `beforeEach(title, fixtures, children)` function, plus `file.d.ts`'s own comment "Insert test.beforeEach for Backgrounds" — emits a generated `test.beforeEach(...)` call into the package's own gitignored generated-test output directory for each feature's `Background:`. That output directory isn't part of the tracked tree either (it's gitignored per `playwright-bdd`'s own convention, same as noted in the sibling doc below) — this is expected, normal generated output, not anything hand-written in this repo. Running a manual `bddgen` first and then invoking `playwright test` right after gives `playwright-bdd` two back-to-back opportunities to generate/load that output in a way that can collide — the loader ends up re-requiring already-generated files (with their `test.beforeEach()` calls) outside of the single generation pass Playwright's test runner expects, which is what `_TestTypeImpl._currentSuite` rejects. The practical fix doesn't require pinning down every internal step of that collision — it's enough to know that a single `playwright test` invocation (which generates exactly once, automatically) avoids it entirely.

## Prevention

- To run one scenario by exact spec path and grep filter, use a single `playwright test` invocation (`npx playwright test tests/e2e/<spec>.feature.spec.js -g "<scenario name>"`) — never precede it with a standalone `bddgen` call in the same shell session.
- If step/fixture files changed and you want to sanity-check generation succeeds before running anything, `npx playwright test --list` (also documented in the sibling `playwright-bdd-bddgen-requires-object-destructuring-first-param.md` doc) exercises the same generation path without this double-invocation risk, since it's still a single `playwright test` invocation.
- If `bddgen` genuinely must be run standalone (e.g. to inspect `.features-gen/` output directly), don't chain a `playwright test` invocation immediately afterward in the same command line — run it as a separate, later step, or just trust `playwright test`'s own automatic generation instead of the manual step.

## Related Issues

- `docs/solutions/integration-issues/playwright-bdd-bddgen-requires-object-destructuring-first-param.md` — same toolchain (`playwright-bdd`/`bddgen`) and same test suite, but an unrelated, differently-triggered error (a step function's first-parameter shape, not a double-generation collision).
