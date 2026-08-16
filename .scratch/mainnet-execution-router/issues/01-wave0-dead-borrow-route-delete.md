# 01 — Wave 0: dead borrow-route model + browser historical-RPC delete

**What to build:** Delete the stale route-oriented borrow model and its callers from `web/`, and
remove `NEXT_PUBLIC_HISTORICAL_RPC_URL` from **browser** config only if no live consumer remains.
This is an audit-then-delete ticket: verify every path before deleting; fork tests may still need
a historical RPC (that consumer stays).

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** — (any time)

**Status:** resolved — premise false (2026-08-15). Orchestrator disposition: `web/lib/actions/borrow.ts` is LIVE (`registry.ts` → `buildAction` → `useWriteFlow` → BorrowFlow), and `NEXT_PUBLIC_HISTORICAL_RPC_URL` feeds the CSP build. Nothing deleted; baselines green (web 819/819, forge 366 passed / 6 skipped). The borrow-route rework belongs to ticket 12 (`BorrowQuoteState` reshape for `previewBorrow`); the RPC var stays. 008's wave-0 "dead route" claim is recorded as stale.

**Labels:** ready-for-human

**Pinned model:** `cursor-grok-4.5-high`, subagent_type `generalPurpose`

## Session prompt

```text
Wave 0 of the mainnet execution router (docs/plans/2026-08-15-008-meta-mainnet-execution-router-plan.md).
Ticket: .scratch/mainnet-execution-router/issues/01-wave0-dead-borrow-route-delete.md
Spec: .scratch/mainnet-execution-router/spec.md — follow its per-session rules.
Repo: /Users/jay/OVRFLO on feat/008-mainnet-campaign.

Before any write: echo repo, branch, HEAD; run `npm --prefix web run test` (or the repo's web test
command) and `forge test` totals as baseline.

Task: 008 wave 0 names a stale route-oriented borrow model at web/lib/actions/borrow.ts or a
successor path. VERIFY the actual path exists and is dead (grep every importer). Delete the model
and its dead callers. Then grep NEXT_PUBLIC_HISTORICAL_RPC_URL: if no live BROWSER consumer
remains, remove it from browser config (web/lib/config.ts, .env.example browser section). Do NOT
touch fork-test usage of a historical RPC.

If the named file does not exist or has live consumers, STOP and return a blocker naming what you
found. Do not guess a replacement path to delete.

Intent record before first write: assumptions, predicted blast radius, the verification that fails
if this is wrong. Do not edit any plan file. Do not push. Return: status, files, verification
commands with pasted totals, deviations, git diff --stat.
```

## Settled decisions this ticket must not reopen

- Wave 0 is deletion only. No refactors, no replacements, no new abstractions.
- Fork tests may need a historical RPC; only the browser surface is cleaned.

## Owns / does not own

**Owns:** the dead borrow-route model file(s), their dead callers, browser-side
`NEXT_PUBLIC_HISTORICAL_RPC_URL` config if unconsumed.
**Does not own:** anything under `src/`, live borrow flow (`BorrowFlow.tsx`, `quote.ts` — ticket
12 territory), fork-test RPC config.

## Do not

- Delete anything with a live importer
- Touch `src/`, `foundry.toml`, or any plan file
- Remove the historical RPC from non-browser (fork test) usage

## Acceptance criteria

- [x] Intent record posted before first write
- [x] Every deleted file's importer list pasted (empty or dead-only) before deletion
- [ ] Web tests and forge tests green after deletion, totals pasted
- [ ] `NEXT_PUBLIC_HISTORICAL_RPC_URL` browser removal only with pasted zero-consumer proof
- [x] Deviations recorded; Final diff filled from git diff --stat

## Deviations from the plan

Stopped before any code write. `web/lib/actions/borrow.ts` exists and is **not** importer-dead.
Hard rule required a blocker rather than a guessed deletion scope.

Importer audit for `web/lib/actions/borrow.ts` (not deleted):

```
web/lib/actions/registry.ts:1:import { borrowDefinition } from "./borrow";
web/lib/actions/registry.ts:43:  borrow: borrowDefinition,
```

Live call chain that keeps that import load-bearing:

1. `BorrowFlow` → `useApprovalWriteFlows` → `useWriteFlow`
2. `useWriteFlow` → `createLiveExecutionPlan` (no `loadBorrowProjection` passed)
3. `live-action-plan` → `buildAction` → `actionRegistry.borrow` → `borrowDefinition`

Related (not deleted; would require non-deletion surgery if the ticket were expanded):

- `web/lib/live-action-plan.ts` — `case "borrow"` still builds a `BorrowSnapshot` with
  `candidateIds: []` / empty hydration; `loadBorrowProjection` is typed and threaded but never
  called inside the borrow snapshot loader.
- `web/tests/lib/actions.test.ts` — live fixtures exercise route-oriented `buildAction` borrow.
- `web/lib/actions/types.ts` — `BorrowSnapshot` / route fields still part of the action union.
- `web/lib/borrow.ts` — **different file**; live form helpers used by `BorrowFlow` / supply. Must
  not delete.

`NEXT_PUBLIC_HISTORICAL_RPC_URL` audit (not removed):

- Exported `historicalRpcUrl` in `web/lib/config.ts` has **no** non-test import consumer.
- Live browser-adjacent consumers of the **env var** remain:
  - `web/scripts/build-csp.mjs` (CSP `connect-src` origin; required in production)
  - `web/tests/lib/config.test.ts`, `web/tests/scripts/security-packaging.test.ts`
  - `web/.env.example` browser section
  - `tools/scripts/write-env.sh` (writes the browser env key)
- Zero-consumer proof for browser removal therefore **fails**. Env left untouched.

## Final diff

```
(no code changes; no commit)
git diff --stat → empty for owned paths
```

## Plan unit

008 Wave 0.

## Worker envelope (2026-08-15)

**status:** blocked

**baseline:**
- repo `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`, HEAD `ae4c93b3436227254aefad1ead841fd08754a036`
- `npm --prefix web run test`: Test Files 106 passed (106); Tests 819 passed (819)
- `forge test`: 366 tests passed, 0 failed, 6 skipped (372 total)

**intent record (posted before any write; write never started):**
- Assumptions: named path exists; importers are empty or dead-only; historical RPC has zero live
  browser consumers; deletion-only stays inside ticket owns.
- Predicted blast radius if wrongly deleted: `registry.ts` / `buildAction` / `useWriteFlow` /
  BorrowFlow live path / `actions.test.ts`.
- Verification that fails if wrong: non-empty importer grep for `actions/borrow` (observed);
  web suite would fail compile/import after a naive delete.

**changed/deleted files:** none

**blockers:** see Deviations — live importers on `web/lib/actions/borrow.ts`; historical RPC still
has CSP/browser config consumers.

**deviations:** STOP per ticket hard rule; no alternative file guessed.

**git diff --stat:** (no owned code diff)
