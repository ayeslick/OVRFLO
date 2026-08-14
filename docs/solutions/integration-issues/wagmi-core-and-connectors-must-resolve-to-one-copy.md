---
title: wagmi core and connectors must resolve to one copy
date: 2026-08-14
category: integration-issues
module: web/lib/wagmi.ts, web/scripts/check-wagmi-dedupe.mjs
problem_type: build_error
component: tooling
symptoms:
  - "Reown adapter Config and wagmi Config resolved as two distinct types"
  - "web/lib/wagmi.ts only compiled behind an as unknown as cast on wagmiConfig"
  - "That cast hid a real @wagmi/core version skew at the wallet provider seam"
  - "npm install could reintroduce nested copies without failing the build"
root_cause: config_error
resolution_type: tooling_addition
severity: high
tags: [wagmi, reown, overrides, check-wagmi-dedupe, lint-deps]
related_components: [web/package.json, web/tests/scripts/wagmi-dedupe.test.ts]
---

# wagmi core and connectors must resolve to one copy

## Problem

Reown's adapter builds `Config` with its `@wagmi/core`. `WagmiProvider`
consumes `Config` from wagmi's `@wagmi/core`. When npm installs two versions,
the assignment in `web/lib/wagmi.ts` is two nominally distinct types. A cast makes
the build green and hides a real incompatibility at the one seam where a
wallet connection either reaches the app hooks or does not.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- `export const wagmiConfig: Config = wagmiAdapter.wagmiConfig` failed without
  `as unknown as`.
- Nested `node_modules/@reown/.../node_modules/@wagmi/core` could differ from
  the top-level copy.
- A later `npm install` could restore the split with no test going red.

## What Didn't Work

Casting through `unknown`. The comment in `web/lib/wagmi.ts:39-48` states why
the assignment must stay uncast: version skew must fail the build at this
edge.

Query-key dedup across React hooks is a different problem. Two components
calling the same `useReadContract` is not two copies of `@wagmi/core`.

## Solution

`package.json` `overrides` pins `@wagmi/core` and `@wagmi/connectors` to one
version each (`web/package.json:49-52`).

`check-wagmi-dedupe.mjs` walks `node_modules` (including nested and scoped
trees) and fails if a guarded package has more than one version
(`web/scripts/check-wagmi-dedupe.mjs:17-65`). `npm run lint:deps` runs that
script. `pretest` runs `lint:deps` (`web/package.json:15`, `:20`).

The assignment stays a plain typed export
(`web/lib/wagmi.ts:49`).

Tests build the nested layouts npm actually produces and assert the guard goes
red (`web/tests/scripts/wagmi-dedupe.test.ts`).

## Why This Works

One copy means one `Config` type. The compiler checks the adapter/provider
seam. The walk fails the build if a future install reintroduces the split.

## Prevention

- Keep `wagmiConfig` uncast. A compile error here is the signal.
- Keep `overrides` for both `@wagmi/core` and `@wagmi/connectors`.
- Keep `lint:deps` on `pretest`. A guard that is not in the test path reports
  green by absence.
- The unit test must keep a nested duplicate fixture. A pass-only fixture
  cannot prove the guard fails.

## Related Issues

- [Wagmi query-key dedup](../architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md)
  — hook call-site dedup, not package-copy dedup.
- [Wagmi mock connector hydration mismatch](../runtime-errors/wagmi-mock-connector-hydration-mismatch-missing-ssr-flag.md)
  — another wagmi provider-seam failure that a cast would also hide.
