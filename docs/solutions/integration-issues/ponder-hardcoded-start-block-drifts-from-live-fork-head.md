---
title: "Hardcoded Ponder START_BLOCK drifted 1M+ blocks behind the live Anvil fork head, forcing multi-hour backfills"
date: 2026-07-28
category: integration-issues
module: tools/ponder/ponder.config.ts
problem_type: integration_issue
component: tooling
symptoms:
  - "PositionList.tsx's STREAMS section showed \"UNABLE TO LOAD POSITIONS\" during local E2E runs, initially mistaken for a test flake"
  - "Ponder's TUI stuck in backfill (0.1%) at block 24,610,427 roughly 25 seconds after a fresh restart, projecting ~8 hours to reach 100%"
  - "The fork's live head (~25,632,584) had drifted over 1,000,000 blocks past the hardcoded const START_BLOCK = 24609500 by the time this was diagnosed"
  - "disableCache: true meant every restart re-walked the full stale range from scratch, so the cost only grew over time as the real chain head kept moving away from the constant"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [ponder, bootstrap, anvil-fork, start-block, backfill, e2e, live-fork-discovery]
related_components: [Ponder, OVRFLOLending, SablierV2LockupLinear]
---

# Hardcoded Ponder START_BLOCK drifted 1M+ blocks behind the live Anvil fork head, forcing multi-hour backfills

## Problem

Ponder (the local Sablier/OVRFLOLending indexer used by the web app's `PositionList.tsx` STREAMS section) was configured with a hardcoded historical `startBlock` in `tools/ponder/ponder.config.ts`, but the local Anvil fork it indexes is always started against the live mainnet head with no `--fork-block-number` pin. Every restart forced Ponder to backfill from that stale constant instead of from the fork's actual starting block, so it never caught up to any locally-seeded data within a usable timeframe.

## Symptoms

- `PositionList.tsx`'s STREAMS section showed no data / "UNABLE TO LOAD POSITIONS" for a connected wallet's Sablier streams, initially suspected to be Playwright E2E test flakiness.
- Ponder's local dev TUI reported `backfill (0.1%)` rather than `live`, even well after the process had been running.
- Directly measured: ~25 seconds after a fresh restart, the TUI showed only `backfill (0.1%)` at block 24,610,427, against a live fork head that had drifted to ~25,632,584 — over 1,000,000 blocks past the hardcoded constant (`24609500`) that `tools/ponder/ponder.config.ts` used as `startBlock`. Extrapolating that rate implied roughly 8 hours to reach 100%.
- The gap grew across sessions rather than staying fixed, because the live-fork-head mainnet block number keeps advancing every time `bootstrap-local.sh` is run, while the hardcoded constant obviously does not.

## What Didn't Work

1. **Assuming it was a `PositionList.tsx` bug.** The component's blanket error state, which collapses three independent data sources (liquidity/loanBook/streams) into a single error, was a real, separate bug — documented at `docs/solutions/ui-bugs/positionlist-blanket-error-hides-onchain-positions.md` — but fixing it alone did not resolve the failing E2E tests, because the underlying Sablier stream data genuinely did not exist yet from Ponder's point of view: it hadn't backfilled far enough to see any of it.
2. **Restarting the Ponder process.** Running `pkill -f "ponder dev"` and then `npm --prefix web run ponder:dev` again, on the assumption a hung/crashed process just needed a fresh start, did not help. `startBlock` was still the same hardcoded historical constant, so every restart re-began the same ~8-hour backfill from 0%.
3. **Leaving the stale `.ponder/pglite` cache directory in place across restarts**, hoping it held resumable progress. It did not: a restart with the pre-existing cache present still showed `backfill (0.1%)` from the same historical starting point. `tools/ponder/ponder.config.ts` sets `disableCache: true` at the chain level (pre-existing, unrelated to this fix), which forces a from-scratch RPC re-walk from `startBlock` regardless of any locally cached indexed data.

## Solution

**1. `tools/ponder/ponder.config.ts` — removed the hardcoded fallback block entirely and fail loudly instead:**

```ts
// No fixed fallback block: this project's only OVRFLO deployment is always
// fresh at whatever block the fork happened to be at when seed-local.sh ran
// (it discovers live Pendle markets and deploys against "now" — see
// docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-
// and-fork-fixtures.md), so nothing before that block is ever relevant —
// every OVRFLOLending/Sablier event a run needs is created *during* that same
// run. A hardcoded historical constant only grows more expensive over time
// (the real chain head keeps moving away from it, and `disableCache: true`
// above means every restart re-walks from startBlock from scratch regardless
// of prior progress), so the caller must always supply the real starting
// point instead. bootstrap-local.sh passes PONDER_START_BLOCK as the fork's
// own starting block number (`cast block-number` right after anvil starts).
if (!process.env.PONDER_START_BLOCK) {
  throw new Error(
    "PONDER_START_BLOCK is not set — pass the fork's own starting block (e.g. `cast block-number --rpc-url $PONDER_RPC_URL` right after anvil starts), not a fixed historical constant. See bootstrap-local.sh.",
  );
}
const START_BLOCK = Number(process.env.PONDER_START_BLOCK);
```

`START_BLOCK` is then used as `startBlock` for both `contracts.SablierV2LockupLinear` and `contracts.OVRFLOLending`, the latter a Ponder `factory()` pattern keyed off the `OVRFLOFactory`'s `LendingDeployed` event.

**2. `tools/scripts/bootstrap-local.sh` — thread the fork's own current block through to Ponder.**

The script already computed the fork's starting block right after anvil came up, for use in a later health check:

```bash
FORK_START_BLOCK=$(cast block-number --rpc-url http://127.0.0.1:8545)
```

The fix adds `PONDER_START_BLOCK="$FORK_START_BLOCK"` alongside the pre-existing `PONDER_RPC_URL`/`PONDER_OVRFLO_FACTORY` env vars on the Ponder launch line:

```bash
PONDER_RPC_URL=http://127.0.0.1:8545 PONDER_OVRFLO_FACTORY="$LOCAL_FACTORY" PONDER_START_BLOCK="$FORK_START_BLOCK" npm --prefix web run ponder:dev >".bootstrap.ponder.log" 2>&1 &
```

**3. New `tools/scripts/bootstrap-e2e.sh`** composes existing pieces into one idempotent "tear down and rebuild" command for E2E runs:
- `tools/scripts/bootstrap-clean.sh local` (teardown)
- `BOOT_NO_UI=1 tools/scripts/bootstrap-local.sh` (anvil + seed + ponder, now carrying the `PONDER_START_BLOCK` fix)
- a newly backgrounded dev server, tracked via a new `.bootstrap.web.pid` file mirroring the anvil/ponder pid-file convention:
  ```bash
  (
    cd web
    NEXT_PUBLIC_E2E=1 nohup npm run dev >"../$WEB_LOG" 2>&1 &
    echo $! > "../$WEB_PID_FILE"
  )
  ```
- `npx bddgen` to regenerate Playwright/Gherkin specs

This was added because manually running the steps one-by-one, while a second background agent was concurrently restarting anvil/reseeding, caused real environment corruption (`deployments/local.json`'s addresses shifting under a dev server that only reads `web/.env.local` at process start, plus risk of colliding `evm_snapshot`/`evm_revert` calls against the same shared Anvil process). A single idempotent script removes that whole risk class.

**4. `tools/scripts/bootstrap-clean.sh` extended to also track/kill the dev server**, structurally identical to the pre-existing `kill_orphaned_ponder` (see Related Issues):

```bash
kill_orphaned_next_dev() {
  local repo_root pattern pids
  repo_root="$(pwd)"
  pattern="${repo_root}/web/node_modules/.bin/next dev"
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  # ... kill, wait, escalate to -9, same shape as kill_orphaned_ponder
}
```

It also now kills `.bootstrap.web.pid`, removes the new web dev log, and removes `tools/ponder/.ponder` (the Ponder cache directory) on every teardown — since a cache tied to a torn-down fork is meaningless, and `disableCache: true` meant keeping it around never bought anything anyway.

**5. `web/package.json`** gained a `"bootstrap:e2e": "cd .. && ./tools/scripts/bootstrap-e2e.sh"` script entry alongside the existing `bootstrap:local` / `bootstrap:local:clean` / `bootstrap:devnet` entries.

## Why This Works

The root cause was a config-error mismatch between two assumptions that used to hold together but drifted apart: `ponder.config.ts` assumed a fixed historical `startBlock` was "close enough" to be cheap to backfill, while `bootstrap-local.sh` (by design, per `docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md`) forks the live, ever-advancing mainnet head with no block pin — because `seed-local.sh` needs to discover Pendle markets whose expiry is relative to "now." Every day that passes, the live fork head moves forward while the hardcoded constant does not, so the backfill distance — and therefore the time before Ponder has any usable data — only grows. Combined with `disableCache: true` (which forces a from-scratch RPC walk on every restart, since Ponder's own cache is never trusted), this constant was a slow-motion time bomb: it worked when it was written, and would silently get worse indefinitely.

The fix works because the vault's only local deployment is *always* freshly created at the fork's own current block by `script/seed-local.sh` on every run. Nothing before that block is ever relevant — every Sablier stream and OVRFLOLending event a local/E2E session needs is created *during* that same session, against contracts that did not exist before the fork started. Deriving `PONDER_START_BLOCK` from `cast block-number` immediately after anvil boots ties Ponder's indexing window to the one invariant that's actually true regardless of when the script is run, instead of a number that was only ever true on the day it was typed in.

**Verified:** after the fix, restarting via `tools/scripts/bootstrap-e2e.sh` showed Ponder's TUI report `live` status (not `backfill`) within seconds, tracking the live chain head in real time — independently confirmed via `curl -s http://localhost:42069/status` returning a block number matching the fork's actual current block.

## Prevention

- Any new Ponder-indexed contract in `tools/ponder/ponder.config.ts` must derive its `startBlock` from the fork's own current state (`cast block-number` right after anvil starts, threaded in via an env var) — never a hardcoded historical block number, even as a "just in case" fallback. `ponder.config.ts` now enforces this at config-load time by throwing if `PONDER_START_BLOCK` is unset, so a caller forgetting to pass it fails immediately and loudly instead of silently backfilling for hours.
- Code-review checklist item for anything under `tools/ponder/`: search the diff for any bare integer literal used as `startBlock` — e.g. `grep -n "startBlock" tools/ponder/ponder.config.ts` should only ever show `startBlock: START_BLOCK` (or an equivalent derived variable), never `startBlock: <number>`.
- When a Ponder-dependent E2E test seems to intermittently fail with missing data, check the Ponder TUI/log for `backfill` vs `live` status (or `curl -s http://localhost:42069/status`) before assuming the failure is a frontend or test bug — this class of failure looks identical to flakiness but is actually the indexer not having reached the chain head yet.
- Use `tools/scripts/bootstrap-e2e.sh` (via `npm --prefix web run bootstrap:e2e`) for E2E environment setup rather than composing `bootstrap-local.sh`/`ponder:dev`/`next dev` manually, especially when another agent or process might be touching the same local Anvil fork concurrently — the idempotent teardown-then-rebuild removes an entire class of "which step did I forget" and "who else is touching this fork" bugs.

## Related Issues

- `docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md` — the architectural reason the local fork has no block pin in the first place (live Pendle market discovery needs "now"), which is exactly why nothing before the fork's own current block is ever relevant to the local Ponder instance either.
- `docs/solutions/runtime-errors/orphaned-ponder-dev-process-survives-bootstrap-clean.md` — a different bug in the same area (bootstrap-clean.sh only killing the npm-wrapper PID, not the real grandchild process), but its `pgrep -f` repo-scoped orphan-cleanup pattern is directly reused here for the new dev-server tracking in `bootstrap-clean.sh`.
- `docs/solutions/integration-issues/ponder-factory-address-export-order-bootstrap-20260727.md` — another Ponder/`bootstrap-local.sh` env-var wiring bug from the same area, but a distinct root cause (Ponder capturing a zero-address factory because it launched before `web/.env.local` was written) — worth distinguishing from this doc rather than conflating the two.
