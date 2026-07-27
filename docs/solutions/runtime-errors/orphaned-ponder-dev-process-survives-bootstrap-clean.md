---
title: "bootstrap:local:clean left an orphaned ponder dev process running after every cycle"
date: 2026-07-27
category: runtime-errors
module: tools/scripts/bootstrap-clean.sh
problem_type: runtime_error
component: tooling
symptoms:
  - "`ps aux | grep \"ponder dev\"` shows a live `node .../tools/ponder/node_modules/.bin/ponder dev` process even after `npm --prefix web run bootstrap:local:clean` reports \"stopping ponder (pid ...)\" and exits 0"
  - "Repeated local bootstrap/clean cycles accumulate one extra orphaned ponder process per cycle"
root_cause: logic_error
resolution_type: code_fix
severity: low
tags: [bootstrap, ponder, process-lifecycle, orphaned-process, local-dev, pgrep]
related_components: [Ponder]
---

# bootstrap:local:clean left an orphaned ponder dev process running after every cycle

## Problem

`tools/scripts/bootstrap-clean.sh` kills only the PID recorded in `.bootstrap.ponder.pid`, but that recorded PID is the `npm --prefix web run ponder:dev` wrapper process launched by `tools/scripts/bootstrap-local.sh`, not the actual Ponder indexer. Killing the wrapper does not propagate to the real `ponder dev` process it spawns underneath, so the indexer survives every `bootstrap:local:clean` call.

## Symptoms

- `ps aux | grep "ponder dev"` shows a live `node /path/to/tools/ponder/node_modules/.bin/ponder dev` process after clean has already run and reported success.
- The leaked process accumulates: every `npm --prefix web run bootstrap:local` followed by `bootstrap:local:clean` cycle leaves one more of these running in the background, consuming memory (observed at roughly 600-700MB RSS per orphan in this repo) until the machine is restarted or the processes are found and killed manually.

## What Didn't Work

**Attempted framing 1: "just wait a beat before SIGKILL."** `kill_pid_file` in `bootstrap-clean.sh` already sends `SIGTERM` to the recorded PID, waits up to 1 second polling `kill -0`, then falls back to `SIGKILL` — this is correct handling for the *recorded* process, but does nothing for a different PID entirely (the grandchild) that was never recorded anywhere.

**Attempted framing 2 (considered, not implemented): change process-group ownership so `kill -- -$PGID` reaches every descendant.** The standard fix for "kill this whole process tree" is to launch the parent in its own process group (via `setsid`, or bash job-control's `set -m`) and signal the negative PID (the group) instead of a single PID. Two variants were considered and rejected for this repo:
  - `setsid` is not installed on this macOS dev machine — it ships with util-linux, which is not part of the BSD/macOS base toolchain, so relying on it would add an undocumented external dependency for every contributor on macOS.
  - Enabling `set -m` (job control) inside `bootstrap-local.sh` would make every backgrounded command (`anvil ...&`, `npm run ponder:dev &`) start its own process group, which is the desired property here — but the script backgrounds *multiple* long-running jobs and already relies on `set -euo pipefail` plus explicit PID-file bookkeeping for both anvil and Ponder. Enabling job control non-interactively changes shell behavior more broadly (job-control status messages, `wait` semantics) in a script that has other invariants depending on its current behavior, for a fix that only needs to solve one specific process tree. The risk/reward didn't favor a shell-mode change over a narrowly-scoped addition to the cleanup script.

## Solution

Added a fallback cleanup step to `bootstrap-clean.sh` that finds and kills any orphaned `ponder dev` process directly by its distinctive on-disk path, independent of whatever PID happened to get recorded:

```bash
# npm --prefix web run ponder:dev` (started by bootstrap-local.sh) is a
# wrapper: npm -> sh -> node -> the actual `ponder dev` binary. Killing only
# the recorded npm-wrapper PID does not propagate to that grandchild, so it
# survives as an orphan after every bootstrap/clean cycle. This repo-scoped
# fallback finds and kills any leftover `ponder dev` process directly by its
# distinctive on-disk path, independent of the (possibly-already-dead)
# recorded PID.
kill_orphaned_ponder() {
  local repo_root pattern pids
  repo_root="$(pwd)"
  pattern="${repo_root}/tools/ponder/node_modules/.bin/ponder"
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "bootstrap-clean: found orphaned ponder dev process(es) not covered by the recorded pid: $pids"
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      pids=$(pgrep -f "$pattern" 2>/dev/null || true)
      [ -z "$pids" ] && break
      sleep 0.2
    done
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    CLEANED=1
  fi
}
```

Called immediately after the existing `kill_pid_file "ponder" ".bootstrap.ponder.pid"` in the `local` branch of `bootstrap-clean.sh`.

The pattern anchors on `$(pwd)` — the script already does `cd "$(git rev-parse --show-toplevel)"` at the top — so it can only ever match a `ponder dev` process launched from *this* repo's `tools/ponder`, not an unrelated Ponder process from another project on the same machine.

## Why This Works

`pgrep -f` matches against the full command line of every running process, not just the top-level PID recorded by the shell that launched it. Since the actual Ponder indexer's argv contains the absolute path `.../tools/ponder/node_modules/.bin/ponder dev` (confirmed via `ps aux` — `node /Users/jay/OVFL/tools/ponder/node_modules/.bin/ponder dev`), this finds the real process regardless of how many wrapper layers (`npm` → shell → `node`) sit above it in the process tree, and regardless of whether the originally-recorded PID is stale, already dead, or was never the right PID to begin with.

Verified end-to-end: ran `bootstrap:local` (`BOOT_NO_UI=1`), confirmed via `ps aux` that the actual grandchild process's PID (`26853`) was different from the recorded npm-wrapper PID (`26798`, the one written to `.bootstrap.ponder.pid`), then ran `bootstrap:local:clean` and observed the new log line `found orphaned ponder dev process(es) not covered by the recorded pid: 26853` immediately followed by its termination. `ps aux | grep "ponder dev"` returned nothing afterward.

## Prevention

- **When a script backgrounds a process, verify what PID actually gets recorded matches what needs to be killed later** — for any command that is itself a wrapper (`npm run <script>`, `bundle exec`, language-runtime launchers), the recorded `$!` is the wrapper's PID, not necessarily the PID of whatever does the real work underneath. A quick `pstree`/`ps -ef` sanity check when adding a new backgrounded dev-tool process would have caught this at introduction.
- **A repo-scoped `pgrep -f` fallback is a reasonable general pattern for orphan cleanup** in local dev tooling scripts, when process-group-based tree-killing (`setsid`, `set -m`) isn't a good fit for the existing script structure or isn't installed on every target platform. Anchor the pattern on an absolute, repo-rooted path so it can't false-positive-match an unrelated process on a shared machine.
- **Idempotent, re-runnable cleanup**: `kill_orphaned_ponder()` is safe to call even when nothing is orphaned (empty `pgrep` result, no-op) and safe to call repeatedly (already-dead PIDs are silently ignored by `kill`), matching this script's existing idempotency contract (`bootstrap-clean: nothing to clean for $NETWORK profile.` when there's nothing to do).

## Related Issues

- [Local bootstrap launched Ponder before the factory address existed in its env, silently indexing nothing](../integration-issues/ponder-factory-address-export-order-bootstrap-20260727.md) — the doc that first flagged this exact orphaned-process bug as an unfixed follow-up, discovered while verifying that fix
- [Post-refactor dead code in web/ after indexer + USD rewiring](../developer-experience/post-refactor-dead-code-WebUI-20260421.md) — a different kind of local-tooling cleanup debt in the same general area (unused code vs. leaked runtime process), similar "clean up what a refactor left behind" spirit
