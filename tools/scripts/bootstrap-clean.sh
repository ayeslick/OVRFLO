#!/usr/bin/env bash
# bootstrap-clean.sh — teardown for bootstrap-local.sh / bootstrap-devnet.sh.
# Idempotent: running with nothing up exits 0 with a "nothing to clean" line.
#
# Usage:
#   tools/scripts/bootstrap-clean.sh local
#   tools/scripts/bootstrap-clean.sh devnet

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

NETWORK="${1:-}"
if [ "$NETWORK" != "local" ] && [ "$NETWORK" != "devnet" ]; then
  echo "bootstrap-clean: first arg must be 'local' or 'devnet'" >&2
  exit 2
fi

CLEANED=0

kill_pid_file() {
  local label="$1" file="$2"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "bootstrap-clean: stopping $label (pid $pid)"
      kill "$pid" 2>/dev/null || true
      # Give it a second to exit cleanly before SIGKILL.
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.2
      done
      kill -9 "$pid" 2>/dev/null || true
      CLEANED=1
    fi
    rm -f "$file"
  fi
}

rm_if_exists() {
  local label="$1" path="$2"
  if [ -e "$path" ]; then
    rm -rf "$path"
    echo "bootstrap-clean: removed $label ($path)"
    CLEANED=1
  fi
}

if [ "$NETWORK" = "local" ]; then
  kill_pid_file "anvil" ".bootstrap.pid"
  kill_pid_file "ponder" ".bootstrap.ponder.pid"
  rm_if_exists "anvil log"  ".bootstrap.anvil.log"
  rm_if_exists "ponder log" ".bootstrap.ponder.log"
  rm_if_exists "env.local"  "web/.env.local"
  rm_if_exists "deployment artifact" "deployments/local.json"
else
  rm_if_exists "env.devnet" "web/.env.devnet"
  # Intentionally leave deployments/devnet.json — it's the record of what's
  # already on the VTN and is needed for EXISTING_FACTORY reuse-mode.
fi

if [ "$CLEANED" = "0" ]; then
  echo "bootstrap-clean: nothing to clean for $NETWORK profile."
fi
