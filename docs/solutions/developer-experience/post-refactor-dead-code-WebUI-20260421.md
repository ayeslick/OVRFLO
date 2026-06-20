---
module: Web UI
date: 2026-04-21
problem_type: developer_experience
component: nextjs_react
symptoms:
  - "web/hooks/useApprovedMarkets.ts existed but was unreferenced after useAllMarkets.ts took over"
  - "NEXT_PUBLIC_FACTORY_FROM_BLOCK env var, parseFromBlock helper and FACTORY_FROM_BLOCK export survived the Sablier indexer revert"
  - "ovrfloAbi still declared the Deposited event after the on-chain log scan was removed"
  - "useUsdPrices exposed nativeUsd via a second CoinGecko request that no component read"
  - "tx-errors.ts exported parseStreamError used only by its own test; runtime error rendering used getErrorMessage instead"
  - "tests/helpers/wagmi-mock.tsx and tests/types/wagmi-config.type-test.ts were not imported by any test file"
  - "tests/fixtures/ was an empty directory"
root_cause: incomplete_setup
resolution_type: code_fix
severity: low
tags: [dead-code, cleanup, env-vars, abi, coingecko, test-helpers]
---

# Troubleshooting: Post-refactor dead code in web/ after indexer + USD rewiring

## Problem

Three back-to-back refactors — single-factory configuration, Sablier log-scan →
Envio indexer revert, and USD price plumbing into modals — each shipped with
their intended behaviour but left unused code in their wake. By the time all
three were merged the frontend carried a hook with zero callers, an env var the
runtime no longer read, an ABI event the client no longer listened for, and
a few tests that did not participate in the test run.

## Environment

- Module: Web UI (`web/`)
- Stack: Next.js 15 / React 19, viem 2.x, wagmi 2.x, TanStack Query 5, Vitest
- Affected files (all under `web/`):
  - `hooks/useApprovedMarkets.ts` (deleted)
  - `hooks/useUsdPrices.ts`
  - `lib/config.ts`
  - `lib/contracts.ts`
  - `lib/tx-errors.ts`
  - `components/StreamList.tsx`
  - `tests/helpers/wagmi-mock.tsx` (deleted)
  - `tests/types/wagmi-config.type-test.ts` (deleted)
  - `tests/fixtures/` (deleted; was empty)
  - `tests/lib/constants.test.ts`
  - `tests/lib/tx-errors.test.ts`
  - `.env.example`
- Date solved: 2026-04-21

## Symptoms

- `rg "useApprovedMarkets" web/` returned only the definition in
  `web/hooks/useApprovedMarkets.ts`; every component had migrated to
  `useAllMarkets`.
- `rg "FACTORY_FROM_BLOCK" web/` matched only `config.ts` and
  `tests/lib/constants.test.ts`; no call site, no runtime read.
- `rg "Deposited" web/` hit only the ABI literal — the Sablier indexer path
  reads events via Envio, not via `publicClient.watchContractEvent`.
- `rg "nativeUsd" web/` matched the field inside `useUsdPrices` plus one local
  consumer inside the same file; no component ever read
  `usdPrices.nativeUsd`.
- `rg "parseStreamError" web/` returned only `lib/tx-errors.ts` and its own
  unit test; runtime error paths use `getErrorMessage` from `lib/errors.ts`.
- `rg "wagmi-mock" web/` had a single hit inside
  `tests/helpers/wagmi-mock.tsx` itself.
- `StreamList.tsx` error copy still said "Confirm the RPC endpoint is
  reachable and that NEXT_PUBLIC_FACTORY_FROM_BLOCK is set appropriately"
  even though the code no longer used that variable.

## What Didn't Work

**Attempted Solution 1: Leave the dead code in place "just in case we revert
the refactor".**

- Why it failed: Dead code silently accumulates cost — it confuses readers,
  skews grep results, and keeps stale assumptions alive (e.g. "we must scan
  logs from a specific block"). The tests around it give false confidence;
  `FACTORY_FROM_BLOCK` tests passed while the constant wasn't read anywhere,
  so the coverage was theatre.

**Attempted Solution 2: Delete files but keep the env var "for future
indexer-less deployments".**

- Why it failed: `.env.example` is the source of truth for how to deploy the
  app. Advertising an env var that has no runtime consumer is worse than not
  advertising it, because the next operator will set it and then wonder why
  it has no effect. If we bring back log scanning, we can add the knob back
  on the same PR.

## Solution

Delete the unused files, prune the unused exports, and update the one piece
of user-visible copy that still referenced them. No behavioural changes.

**Deletions:**

- `web/hooks/useApprovedMarkets.ts` — superseded by
  `web/hooks/useAllMarkets.ts`.
- `web/tests/helpers/wagmi-mock.tsx` — no importers in the test suite.
- `web/tests/types/wagmi-config.type-test.ts` — duplicated assertions in
  `tests/lib/wagmi-config.test.ts` and was not picked up by Vitest's config.
- `web/tests/fixtures/` — empty directory.

**Pruned exports and fields:**

- `web/lib/config.ts`: remove `ENV.factoryFromBlock`, `parseFromBlock()` and
  the `FACTORY_FROM_BLOCK` export.
- `web/.env.example`: remove `NEXT_PUBLIC_FACTORY_FROM_BLOCK` (and all three
  profile mentions); update header from "six knobs" to "five knobs".
- `web/lib/contracts.ts`: remove the `Deposited` event entry from
  `ovrfloAbi` — the UI does not listen for it.
- `web/hooks/useUsdPrices.ts`: remove `nativeUsd` from the `UsdPrices`
  interface and drop the `simple/price?ids=ethereum&vs_currencies=usd`
  request. The remaining path only calls
  `simple/token_price/ethereum?contract_addresses=…`, which is all the UI
  uses today.
- `web/lib/tx-errors.ts`: remove `parseStreamError`; runtime uses
  `getErrorMessage` from `lib/errors.ts` and `StatusPanel` for error copy.
- `web/tests/lib/constants.test.ts`: drop the two `FACTORY_FROM_BLOCK` tests.
- `web/tests/lib/tx-errors.test.ts`: drop the `parseStreamError` assertion
  and trim the import list to `parseUserError`.

**Copy fix:**

- `web/components/StreamList.tsx`: replace the stale
  "NEXT_PUBLIC_FACTORY_FROM_BLOCK" phrasing with
  "Could not load Sablier streams for `${CHAIN_NAME}`. Confirm the Sablier
  indexer is reachable and try again."

**Verification commands (all pass after the cleanup):**

```bash
cd /Users/jay/OVFL/web
./node_modules/.bin/tsc --noEmit
npm test -- --run

# dangling-reference sweep
rg "FACTORY_FROM_BLOCK|useApprovedMarkets|parseStreamError|wagmi-mock|\
nativeUsd|\"Deposited\"" .
```

The grep sweep prints no hits after the change.

## Why This Works

Each removed item had a provable zero consumer set at the time of deletion:

- `useApprovedMarkets` was functionally replaced by `useAllMarkets`, which
  queries the factory's `ovrfloCount` / `ovrflos(i)` / `ovrfloInfo(ovrflo)`
  triple and derives the same shape the UI needs. No component references
  the old hook, so removing the file is a pure surface reduction.
- `FACTORY_FROM_BLOCK` only mattered to an `eth_getLogs`-based scanner. The
  Sablier discovery path uses Envio's indexer (see the integration-issues
  writeup), so the block-number knob has nothing to gate.
- The `Deposited` event ABI is only useful if something in the client calls
  `watchContractEvent` or `getLogs` against it. Neither the read paths
  (`useAllMarkets`, `useOvrflos`, `useStreams`, `useUsdPrices`) nor the write
  paths (`useSendTransaction` helpers) do — after the indexer revert.
- `nativeUsd` was an ETH/USD price fetch for "native gas" UX that never
  shipped. Nothing reads `prices.nativeUsd`, so the second CoinGecko hit is
  pure latency and quota burn on every dashboard cold-load.
- `parseStreamError` specialised messages for a code path (on-chain stream
  scan failures) that no longer exists. The generic `getErrorMessage`
  correctly handles the indexer-specific error strings
  (`StreamScanError("Sablier indexer returned HTTP 500")`, etc.).
- The test helpers and fixtures had no importers; they were dead weight that
  slowed down search and onboarding.

Because the changes are surface-only, the Vitest suite and `tsc --noEmit`
both pass unchanged. No behavioural or performance regression.

## Prevention

- **Delete on the same PR that makes code dead.** When a refactor lands
  (indexer revert, hook consolidation, modal rewrite), the PR body should
  include a checklist of files/symbols that *became* unreferenced — and a
  `rg` one-liner that proves it. The cleanup goes in the same PR.
- **Make `.env.example` a tested artifact.** Add a Vitest unit test that
  loads `.env.example`, confirms every variable it lists is read by
  `lib/config.ts`, and confirms every `NEXT_PUBLIC_*` referenced in code is
  listed there. A mismatch is always a bug — either the doc lies, or the
  code reads an unexported var.
- **ABI hygiene:** only include ABI entries the client actually calls.
  A periodic `rg "name: \"<event>\"" web/lib/contracts.ts` pass compared to
  consumer grep is cheap.
- **CI grep rules:** add `rg` smoke checks like
  `rg -q "parseStreamError|FACTORY_FROM_BLOCK|useApprovedMarkets"` and
  fail the build if any of those reappear unintentionally. (Simpler than a
  full dead-code analyzer and catches the common regression here.)
- **Test helpers must be imported:** if a helper is not imported by any
  `*.test.ts[x]` file, it's not a helper. Delete or wire it up.

## Related Issues

- See also: [../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md](../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md)
  — the refactor that left `FACTORY_FROM_BLOCK`, the `Deposited` ABI entry,
  and Sablier log-scan ABIs behind.
- See also: [../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md)
  — the rewire that left `nativeUsd` and the
  `simple/price?ids=ethereum` fetch behind.
