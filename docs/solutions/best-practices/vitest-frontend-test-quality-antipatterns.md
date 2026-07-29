---
title: Test Quality Patterns to Avoid in Vitest/React Frontend Tests
date: 2026-07-27
category: docs/solutions/best-practices
module: web-test-suite-quality
last_updated: 2026-07-29
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Writing or reviewing Vitest unit tests for web/lib/ pure functions or web/hooks/ React hooks
  - Testing env-parsed config modules, or any module that reads process.env at import time
  - Mocking a module-level singleton (a shared vi.fn(), a client factory) across multiple it() blocks in one file
root_cause: test_isolation
resolution_type: test_fix
tags:
  - vitest
  - frontend
  - test-quality
  - mock
  - environment-variables
  - assertion
---

# Test Quality Patterns to Avoid in Vitest/React Frontend Tests

## Context

A standards review of ~15 `web/tests/lib/` and `web/tests/hooks/` files (added
while expanding edge-case coverage for the OVRFLO frontend) surfaced 28
findings, two of them real bugs masquerading as passing tests. The Solidity
side of this repo already has a sibling doc,
[Solidity/Foundry test quality anti-patterns](solidity-foundry-test-quality-antipatterns.md),
built from an identical review shape on the contract test suite. This doc is
the frontend/Vitest counterpart: same "green is lying" theme, different
mechanisms, because JS module evaluation, `vi.mock`, and mutable shared mocks
create failure modes Solidity's per-transaction EVM state does not have.

The two real bugs were both in `web/tests/lib/ponder.test.ts`, and both are
worth naming precisely because they're easy to reintroduce:

1. A test called `createPonderClient(undefined)` intending to test "no base
   URL configured." But the function under test is
   `createPonderClient(baseUrl = ponderUrl)` — an *explicit* `undefined`
   argument still triggers the default parameter, so the test was actually
   exercising whatever `ponderUrl` happened to resolve to from `web/lib/config.ts`
   at import time. It passed today only because no `.env` was present in CI;
   setting `NEXT_PUBLIC_PONDER_URL` (which `bootstrap:local`'s
   `write-env.sh` does) flipped 3 of 5 tests in the file from pass to fail.
2. A second test in the same file asserted `expect(createClient).not.toHaveBeenCalled()`
   as the very first assertion in a shared, un-reset `vi.fn()`. It only
   passed because it happened to run first; there was no `beforeEach(() =>
   vi.clearAllMocks())` and no `clearMocks` in `vitest.config.ts`. A later
   test's call to the same mock would have made the assertion permanently
   false the moment file-level test order changed (e.g. under
   `--sequence.shuffle`).

The rest of the findings were softer but the same species: tautologies,
vacuous zero-input assertions, unnecessary type-cast workarounds, and
order-dependent golden-vector comparisons. All are cataloged below with the
same "can you mentally falsify this assertion" test the Solidity doc uses.

## Guidance

### 1. A parameter with a default value is not the same as "no argument"

```ts
export function createPonderClient(baseUrl = ponderUrl) { ... }
```

Calling `createPonderClient(undefined)` and calling `createPonderClient()`
are identical in JS — both trigger the default. If the intent is "prove this
function behaves correctly when the app-level config has nothing configured,"
mock the config module directly so the default is pinned, independent of
whatever `.env` file happens to be present on whoever's machine runs the
suite next:

```ts
// Pins ponderUrl to a known value so "unconfigured" tests don't depend on
// the real ambient environment (bootstrap:local's write-env.sh sets
// NEXT_PUBLIC_PONDER_URL, which would otherwise silently flip these tests).
vi.mock("@/lib/config", () => ({ ponderUrl: undefined }));
```

### 2. Reset shared mocks between tests, and prefer `toHaveBeenLastCalledWith`

A module-level `const client = vi.fn(...)` shared across every `it()` in a
file accumulates calls across the whole file unless something clears it. Two
consequences:

- `expect(mock).not.toHaveBeenCalled()` is only meaningful if nothing earlier
  in file-execution order already called it — otherwise it's testing test
  order, not behavior.
- `expect(mock).toHaveBeenCalledWith(x)` passes if *any* prior call matched
  `x`, not just the call this test just made. `toHaveBeenLastCalledWith`
  (or clearing mocks first) ties the assertion to the call under test.

```ts
beforeEach(() => {
  vi.clearAllMocks();
});
```

### 3. A module-eval-time config test needs a dynamic import, not a static one

`web/lib/config.ts`-style modules that parse `process.env` at the top level
(`export const chainId = parseChainId(env.chainId)`) throw *at import time*
if the ambient environment is invalid. A static
`import { chainId } from "@/lib/config"` at the top of a test file evaluates
against whatever the real environment is at file-collection time — before
any `vi.stubEnv` call in any test has run. If that real environment is
invalid (a `.env.local` with a stale chain ID, say), the entire test file
collapses to "0 tests" instead of failing one assertion.

```ts
// Every test that needs a specific env combination gets a fresh module
// instance via resetModules + a dynamic import — never a static top-of-file
// import of an env-parsed module.
async function loadConfig() {
  vi.resetModules();
  return import("@/lib/config");
}
```

Pair this with a file-wide `beforeEach` that stubs every var the module
reads to a known-good default, so no individual test's pass/fail depends on
which other vars happen to be set in the real environment:

```ts
const ENV_KEYS = ["NEXT_PUBLIC_CHAIN_ID", "NEXT_PUBLIC_OVRFLO_FACTORY" /* ...all six */] as const;
beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
});
```

### 4. All-zero / all-digit / empty inputs are usually vacuous

A test that only exercises `0n`, an all-digit-hex address (case folding is a
no-op), or an empty array often can't distinguish the correct implementation
from a broken one, because every plausible mutation of the formula still
produces the same trivial output.

- `loanOutstanding({ obligation: 0n, drawn: 0n, repaid: 0n })` is `0n` no
  matter the subtraction order or comparison operator used internally — the
  real fact being tested (is this loan "open"?) lives in `isLoanOpen`, not
  `loanOutstanding`.
- `LENDER.toLowerCase()` on an address like `0x0000...0111` is a no-op —
  the case-insensitivity code path is never actually exercised. Use an
  address with real hex letters (`0xabc...`) and assert the uppercase-stored
  version still matches the lowercase query.
- `applySlippageDown(0n, 50n) === 0n` holds for every formula shape. Pick an
  input where floor and round-to-nearest diverge (`1n` at 0.5% slippage:
  `0.995` floors to `0`, rounds to `1`) so a floor-vs-round regression is
  observable.

### 5. Don't cast around a real type error — restructure instead

`sablierLockupAbi` is `as const`, so TypeScript narrows `entry.name` to the
literal union of names actually present. Comparing that union against a name
known to be *absent* is a real runtime check, but TS2367 flags it as
comparing disjoint literal types. The fix is not `as string` sprinkled at
every comparison site — widen once, at the boundary where the array becomes
a plain list:

```ts
// Before: `(entry.name as string) === removedFunctionName` at every call site.
// After: widen once in the .map, then compare freely.
const functionNames: string[] = sablierLockupAbi.filter((e) => e.type === "function").map((e) => e.name);
expect(functionNames).not.toContain("calculateMinFeeWei");
```

`as never` is a different smell entirely — it means "assignable to
anything," which defeats the type check rather than working around a real
narrowing conflict. If a value's real type (e.g. `Address`) already
satisfies the function signature, cast to that type, not `never`.

### 6. Golden-vector comparisons should sort both sides unless order is the point

`Object.keys(someRecord)` and `array.filter(...).map(...)` both return
insertion/iteration order, which is almost never a property worth pinning.
A golden-vector test that compares an unsorted derived list against a
literal array fails on a purely cosmetic reordering of the source object —
sort both sides unless the order itself is the behavior under test.

### 7. "Not the generic fallback" is weaker than "the correct specific value"

`expect(copy).not.toBe(GENERIC_FALLBACK)` passes as long as *any*
non-generic string comes back — including the wrong one. When a small
enough set of cases exists (a handful of error-name-to-copy mappings), assert
the exact expected string per case instead of the negative check; the exact
check is not meaningfully more code and catches mis-mappings the negative
check cannot.

### 8. Assert the count, and assert the degenerate input in both directions

`expect(spy).toHaveBeenCalled()` passes whether the code did the right thing
once or the wrong thing twice. When the behaviour under test is *which* things
get touched, the count **is** the behaviour — assert it.

For any predicate or filter, also assert the **empty input** explicitly. An
empty set that matches everything and an empty set that matches nothing are
both plausible implementations, they differ by one `return`, and the difference
is invisible in every non-empty test.

This is not theoretical. While building the R39 scoped invalidation, an edit to
`useWriteFlow` silently failed to apply, so the touched-contract set was never
populated. The predicate then matched **nothing** and post-write invalidation
did nothing at all — strictly worse than the coarse behaviour it replaced, and
with no error anywhere. The only thing that caught it was a test asserting a
count: 3 expected, 2 observed. Both directions are now pinned
(`web/tests/lib/invalidate.test.ts:125`).

The general point: **a silently failed edit is not a no-op** when the code it
targeted was already doing something. `toHaveBeenCalled()` cannot see the
difference between "invalidates the right two things" and "invalidates
nothing"; a count can.

## Why This Matters

Every pattern here converts a green test into a green rectangle with no
enforcement behind it: the default-parameter trap tests the wrong thing
entirely (ambient config, not the code path the name claims), the
un-reset-mock assertion tests file execution order, and the vacuous-input
assertion tests a value that holds regardless of whether the logic is
correct. The two `ponder.test.ts` bugs are the sharpest illustration: they
looked identical to correct tests in a diff, both had descriptive names, and
both passed in CI — the only way to catch them was to actually try setting
the environment variable the tests claimed to be testing the absence of and
watch 3 tests flip.

The frontend-specific twist on the Solidity doc's theme is *shared mutable
state across test-file execution*: `vi.mock` factories, module-eval-time
`process.env` reads, and hoisted `vi.fn()` singletons all persist across
`it()` blocks in ways EVM transaction state never does. A Solidity test's
state resets by construction every `function test_...()`; a Vitest file's
mocks do not reset unless something explicitly clears them.

## When to Apply

- When a function under test has a parameter with a default value derived
  from ambient config or environment — passing `undefined` explicitly is not
  equivalent to omitting the argument (apply Pattern 1).
- When a `vi.mock` factory returns a shared `vi.fn()` used across multiple
  `it()` blocks in one file (apply Pattern 2).
- When the module under test parses `process.env` at the top level, outside
  any function (apply Pattern 3).
- When a test's fixture data is `0n`, an empty string, an all-digit-hex
  address, or an empty array, and the assertion is the "obvious" one for that
  input (apply Pattern 4).
- When a comparison needs `as string`, `as never`, or another cast to silence
  a TypeScript error rather than to reflect the value's real type (apply
  Pattern 5).
- When a test compares a derived list (`Object.keys`, `.filter().map()`)
  against a literal array and order isn't the property under test (apply
  Pattern 6).
- When an assertion checks "not the generic/default value" and a small,
  enumerable set of specific expected values exists instead (apply
  Pattern 7).

## Examples

### Example 1 -- Default-parameter trap masking "unconfigured"

```ts
// BEFORE -- undefined still triggers the `= ponderUrl` default; this tests
// whatever the real environment's ponderUrl resolves to, not "unconfigured."
it("returns null for an empty/undefined base URL", () => {
  expect(createPonderClient(undefined)).toBeNull();
});
```

```ts
// AFTER -- pin the ambient default so the test is deterministic regardless
// of the real environment.
vi.mock("@/lib/config", () => ({ ponderUrl: undefined }));

it("returns null for an empty/undefined base URL", () => {
  expect(createPonderClient(undefined)).toBeNull();
});
```

### Example 2 -- Unfalsifiable assertion on an un-reset shared mock

```ts
// BEFORE -- no beforeEach reset; passes only if this is the first test that
// calls createClient in file-execution order.
it("passes a URL with no trailing slash through unchanged", () => {
  createPonderClient("http://localhost:42069/sql");
  expect(createClient).toHaveBeenCalledWith("http://localhost:42069/sql");
});
```

```ts
// AFTER -- reset before each test, and assert the LAST call, not "any call
// ever made to this mock."
beforeEach(() => {
  vi.clearAllMocks();
});

it("passes a URL with no trailing slash through unchanged", () => {
  createPonderClient("http://localhost:42069/sql");
  expect(createClient).toHaveBeenLastCalledWith("http://localhost:42069/sql");
});
```

### Example 3 -- Static import of an env-parsed module

```ts
// BEFORE -- evaluates web/lib/config.ts against the real ambient env at
// file-collection time; a hostile NEXT_PUBLIC_CHAIN_ID collapses the whole
// file to "0 tests" before any vi.stubEnv call runs.
import { ZERO_ADDRESS, isConfiguredAddress } from "@/lib/config";
```

```ts
// AFTER -- dynamic import per test, after resetModules and any vi.stubEnv
// calls; a local literal for the one constant that doesn't need env context.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
async function loadConfig() {
  vi.resetModules();
  return import("@/lib/config");
}
it("is false for the zero address", async () => {
  const mod = await loadConfig();
  expect(mod.isConfiguredAddress(ZERO_ADDRESS)).toBe(false);
});
```

### Example 4 -- Vacuous all-zero input

```ts
// BEFORE -- every plausible implementation of loanOutstanding returns 0n
// here; this doesn't distinguish correct from broken.
it("treats a zero-obligation loan as fully satisfied", () => {
  expect(loanOutstanding({ obligation: 0n, drawn: 0n, repaid: 0n })).toBe(0n);
});
```

```ts
// AFTER -- the property actually being claimed ("fully satisfied") lives in
// isLoanOpen; assert that too.
it("treats a zero-obligation loan as fully satisfied and not open", () => {
  expect(loanOutstanding({ obligation: 0n, drawn: 0n, repaid: 0n })).toBe(0n);
  expect(isLoanOpen({ obligation: 0n, drawn: 0n, repaid: 0n, closed: false })).toBe(false);
});
```

### Example 5 -- Cast-around-the-type-error vs. widen-once

```ts
// BEFORE -- `as string` at every comparison site to silence TS2367.
expect(sablierLockupAbi.some((entry) => entry.type === "function" && (entry.name as string) === "calculateMinFeeWei")).toBe(false);
```

```ts
// AFTER -- widen once at the .map boundary; no per-comparison casts needed.
const functionNames: string[] = sablierLockupAbi.filter((e) => e.type === "function").map((e) => e.name);
expect(functionNames).not.toContain("calculateMinFeeWei");
```

### Example 6 -- Order-dependent golden vector

```ts
// BEFORE -- eligibilityErrorNames is Object.keys(customErrorCopy); a
// cosmetic reorder of that map fails this test for no behavioral reason.
expect(eligibilityErrorNames).toEqual(["MarketNotApproved", "WrongSender", /* ... */]);
```

```ts
// AFTER -- sort both sides; only the set membership is the real property.
expect([...eligibilityErrorNames].sort()).toEqual(
  ["MarketNotApproved", "WrongSender", /* ... */].sort(),
);
```

### Example 7 -- Negative fallback check vs. exact expected value

```ts
// BEFORE -- passes even if a reason maps to the WRONG non-generic message.
for (const reason of STALE_LIQUIDITY_REASONS) {
  const copy = userFacingError(new Error(`execution reverted: ${reason}`));
  expect(copy).not.toBe(GENERIC_FALLBACK);
}
```

```ts
// AFTER -- a small table pins the exact expected copy per reason.
const expectedCopy: Record<(typeof STALE_LIQUIDITY_REASONS)[number], string> = {
  "OVRFLOLending: liquidity inactive": "Liquidity changed since your quote. Refreshing market depth.",
  // ...
};
for (const reason of STALE_LIQUIDITY_REASONS) {
  expect(userFacingError(new Error(`execution reverted: ${reason}`))).toBe(expectedCopy[reason]);
}
```

## Related

- [Solidity/Foundry test quality anti-patterns](solidity-foundry-test-quality-antipatterns.md) -- the sibling review on the contract test suite; same "green is lying" theme, EVM-specific mechanisms instead of JS-module-eval ones
- [Prefer battle-tested libraries over hand-rolled code](prefer-battle-tested-libraries-over-hand-rolled-code.md) -- companion guidance from the same `web/*` simplification pass that produced this test-expansion ticket
