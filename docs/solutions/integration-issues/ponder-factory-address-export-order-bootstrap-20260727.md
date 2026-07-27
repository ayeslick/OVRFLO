---
title: "Local bootstrap launched Ponder before the factory address existed in its env, silently indexing nothing"
date: 2026-07-27
category: integration-issues
module: tools/scripts/bootstrap-local.sh
problem_type: integration_issue
component: tooling
symptoms:
  - "Borrow-demand column (ticket 09) showed NO DEMAND DATA on every local fork bootstrap, despite tickets 09/10 recording a passing live e2e demand run"
  - "tools/ponder/ponder.config.ts silently fell back to the zero address for the OVRFLOLending factory() entry"
  - "web/.env.local had the correct NEXT_PUBLIC_OVRFLO_FACTORY value, yet Ponder still indexed nothing"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [ponder, bootstrap, env-vars, factory-pattern, anvil-fork, borrow-demand, eth_getLogs, process-ordering]
related_components: [OVRFLOFactory, OVRFLOLending, Ponder]
---

# Local bootstrap launched Ponder before the factory address existed in its env, silently indexing nothing

## Problem

`npm --prefix web run bootstrap:local` starts the local Anvil fork, seeds OVRFLO, launches Ponder, then writes `web/.env.local` — in that order. Ponder captures its environment once at process start, so by the time the factory address was ever written anywhere Ponder would read, the process was already running without it. `tools/ponder/ponder.config.ts` falls back to the zero address for the `OVRFLOLending` factory-pattern contract entry when neither `PONDER_OVRFLO_FACTORY` nor `NEXT_PUBLIC_OVRFLO_FACTORY` is set, which by its own comment "indexes nothing."

## Symptoms

- The demand column built in ticket 09 rendered `NO DEMAND DATA` on every fresh local bootstrap.
- `web/.env.local` — one of several gitignored, generated-at-runtime artifacts referenced throughout this doc (`web/.env*`, `deployments/*.json`; never tracked in the repo, written fresh by each bootstrap run) — had the correct `NEXT_PUBLIC_OVRFLO_FACTORY` value after being written by `tools/scripts/write-env.sh local`, but nothing was reading it.
- Ponder's own TUI showed the `OVRFLOLending:BorrowerLoanPoolCreated` contract entry at a permanent `0` count even after a real borrow was confirmed on-chain.

## What Didn't Work

**Attempted fix 1: trust that `write-env.sh` covers it.** `write-env.sh` only writes `web/.env.local` / `web/.env.devnet` — files the Next.js dev server reads at its own startup. A separately-running Ponder process (`node .../ponder dev`, `tools/scripts/bootstrap-local.sh:88`) had already captured its process environment before `write-env.sh` ever ran (step 4, after Ponder starts in step 3) and does not re-read dotenv files from a sibling process.

**Attempted fix 2: query `cast logs` for the health check without bounding the block range.** Confirming that the factory actually emitted a `LendingDeployed` event is good defense-in-depth, but `cast logs "LendingDeployed(address,address)" --address "$FACTORY"` with no `--from-block` scans from genesis. Anvil forks by lazily forwarding `eth_getLogs` upstream for ranges it hasn't cached locally, and the underlying free-tier archive RPC used for `MAINNET_RPC_URL` rejects `eth_getLogs` ranges over 10 blocks:

```
Error: server returned an error response: error code -32603: Fork Error:
Transport(HttpError(HttpError { status: 400, body: "{\"jsonrpc\":\"2.0\",...
\"message\":\"Under the Free tier plan, you can make eth_getLogs requests
with up to a 10 block range...\"}" }))
```

`set -euo pipefail` meant this aborted the whole bootstrap script mid-run, additionally leaking the already-started `anvil` and `ponder dev` background processes (see Prevention).

## Solution

Export the factory address into Ponder's process environment on the same line that launches it, reading from `deployments/local.json` — the same artifact `write-env.sh` already uses, so there's one source of truth:

```bash
# tools/scripts/bootstrap-local.sh
LOCAL_FACTORY=$(jq -r '.factory' deployments/local.json)
PONDER_RPC_URL=http://127.0.0.1:8545 PONDER_OVRFLO_FACTORY="$LOCAL_FACTORY" \
  npm --prefix web run ponder:dev >".bootstrap.ponder.log" 2>&1 &
```

`deployments/local.json` is written by `script/seed-local.sh` (step 2), which runs *before* Ponder launches (step 3) — the factory address is guaranteed to exist by the time it's read.

Added a startup health check right after Ponder reports ready, bounded to the fork's start block to avoid the `eth_getLogs` range error above:

```bash
LENDING_DEPLOYED_COUNT=$(cast logs "LendingDeployed(address,address)" \
  --address "$LOCAL_FACTORY" --from-block "$FORK_BLOCK" --rpc-url http://127.0.0.1:8545 --json | jq 'length')
if [ "$LENDING_DEPLOYED_COUNT" -gt 0 ]; then
  echo "      health check: factory $LOCAL_FACTORY emitted $LENDING_DEPLOYED_COUNT LendingDeployed event(s) — Ponder should index it"
else
  echo "      WARNING: factory $LOCAL_FACTORY emitted zero LendingDeployed events — Ponder's borrow-demand indexing will find nothing" >&2
fi
```

Verified end-to-end: ran a fresh bootstrap, used the existing two-wallet `tools/scripts/walkthrough-local.sh` to submit a real `createBorrowerLoanPool` call, and watched Ponder's `OVRFLOLending:BorrowerLoanPoolCreated` count go from `0` to `1` within one poll — confirming it was watching the live, correctly-resolved factory-derived lending address, not silently defaulted to zero.

## Why This Works

Environment variables are captured once, at process spawn — a child process never re-reads a dotenv file written by a sibling process after it starts (this is standard POSIX process semantics, not a Ponder-specific quirk). The bug was pure ordering: the value existed on disk (`deployments/local.json`) before Ponder started, but nothing carried it into Ponder's actual environment until a later, unrelated step wrote an entirely different file. Reading `deployments/local.json` directly at the exact moment of the `ponder:dev` launch — rather than depending on `write-env.sh`'s output — collapses the dependency to a single correct order: seed (writes the artifact) → launch Ponder (reads the artifact into its own env).

The `cast logs` range cap is a second, independent lesson: an Anvil fork is not a fully local chain for historical queries — any `eth_getLogs` range it hasn't already cached is proxied to the real upstream RPC, inheriting that provider's rate/range limits. Bounding to the fork's pinned start block (already a known constant in the script) keeps the query local and fast regardless of provider tier.

## Prevention

- **Export env vars for a background process on its own launch line**, inline (`VAR=value command &`), rather than via a file the process is assumed to re-read later. This generalizes beyond Ponder: any `& disown`'d dev-tool process captures its env once.
- **Bound `cast logs` (and any `eth_getLogs`-based tool) with `--from-block`** when running against an Anvil mainnet fork — treat the fork's pinned block as the natural floor for any historical query, not just for seeding.
- **A startup health check that queries the chain directly** (rather than trusting the indexer's own reported status) catches a wrong/zero factory address immediately, instead of surfacing as an ambiguous "no demand data" empty state indistinguishable from genuinely-zero borrows.
- **`set -euo pipefail` scripts that spawn background processes need cleanup on abort.** The health-check RPC error aborted the script mid-run via `set -e`, but the already-forked `anvil` and `ponder dev` processes kept running, orphaned, until manually killed. A `trap` that tears down recorded PIDs on non-zero exit would make aborted bootstraps self-cleaning — noted here as unimplemented for the abort case specifically; the underlying `ponder dev` grandchild-process leak that monitoring surfaced during this same verification is now fixed (see [Related Issues](#related-issues)).

## Related Issues

- [Wall-clock-anchored indexer window excluded every borrow on the local fork](indexer-window-wall-clock-vs-chain-time.md) — a different ticket-09 local-fork indexing bug in the same demand pipeline (chain-time vs wall-clock, not factory resolution)
- [forge script --broadcast reports 'lack of funds' on Anvil mainnet fork](anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md) — another Anvil-fork-specific tooling gotcha in the same local bootstrap path
- [bootstrap:local:clean left an orphaned ponder dev process running after every cycle](../runtime-errors/orphaned-ponder-dev-process-survives-bootstrap-clean.md) — the follow-up fix for the `ponder dev` grandchild-process leak flagged above, filed and resolved the same day
