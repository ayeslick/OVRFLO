#!/usr/bin/env bash
# bootstrap-local.sh — single-command local loop.
#
#   1. precheck (docker, anvil, forge, cast, jq, npm, pnpm, MAINNET_RPC_URL)
#   2. anvil --fork-url $MAINNET_RPC_URL --chain-id 1 --fork-block-number 24609670
#      (PID written to .bootstrap.pid; refuse a second up without :clean)
#   3. script/seed-local.sh  (deploy factory + ovrflo + oracles + seed dev wallet)
#   4. npm --prefix web run envio:up  (starts Envio + postgres + hasura via pnpm)
#   5. tools/scripts/write-env.sh local  (web/.env.local)
#   6. npm --prefix web run dev  (foreground; Ctrl-C unwinds everything
#      unless BOOT_NO_UI=1, in which case bootstrap exits 0 and the
#      backing processes keep running — same mental model as tmux splits)
#
# Each step is independently runnable via its matching npm script; this
# file composes them for the common case.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ANVIL_PID_FILE=".bootstrap.pid"
ANVIL_LOG=".bootstrap.anvil.log"
FORK_BLOCK="24609670"

# ─── precheck ────────────────────────────────────────────────────────────────
fail() { echo "bootstrap-local: $*" >&2; exit 1; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "'$1' is not on PATH. ${2:-}"
  fi
}
require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name is not set. ${2:-}"
  fi
}

require_cmd anvil "Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
require_cmd forge "Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
require_cmd cast  "Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
require_cmd jq    "brew install jq"
require_cmd npm   "Install Node 18+."
require_cmd pnpm  "npm i -g pnpm  (Envio's preferred manager)."
require_cmd docker "Docker Desktop must be installed and running for the Envio stack."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker Desktop first."
require_env MAINNET_RPC_URL "Export your mainnet archive RPC (Alchemy, QuickNode, paid Infura)."

# ─── anvil fork ──────────────────────────────────────────────────────────────
if [ -f "$ANVIL_PID_FILE" ]; then
  EXISTING_PID=$(cat "$ANVIL_PID_FILE" 2>/dev/null || echo "")
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    fail "anvil is already running (pid $EXISTING_PID). Run 'npm --prefix web run bootstrap:local:clean' first."
  fi
  rm -f "$ANVIL_PID_FILE"
fi

echo "[1/5] starting anvil fork @ block $FORK_BLOCK"
anvil \
  --fork-url "$MAINNET_RPC_URL" \
  --chain-id 1 \
  --fork-block-number "$FORK_BLOCK" \
  --silent \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
echo "$ANVIL_PID" > "$ANVIL_PID_FILE"

for _ in $(seq 1 30); do
  if cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! kill -0 "$ANVIL_PID" 2>/dev/null; then
  echo "--- anvil log (last 40 lines) ---" >&2
  tail -n 40 "$ANVIL_LOG" >&2 || true
  rm -f "$ANVIL_PID_FILE"
  fail "anvil exited before accepting RPC connections. Check $MAINNET_RPC_URL."
fi
echo "      pid=$ANVIL_PID  rpc=http://127.0.0.1:8545  log=$ANVIL_LOG"

# ─── seed ─────────────────────────────────────────────────────────────────────
echo "[2/5] seeding OVRFLO (factory + ovrflo + oracles + PT/stETH to dev wallet)"
./script/seed-local.sh

# ─── envio ────────────────────────────────────────────────────────────────────
echo "[3/5] starting local Sablier Envio indexer (postgres:5433, hasura:8080, indexer:8081)"
# envio:up shells into tools/envio and runs `pnpm envio dev` which brings up
# Envio's internal docker-compose + hot-reloads handlers.
# Run in background so bootstrap can continue; indexer catches up from
# start_block in config.yaml (24609500, ~170 blocks behind fork head).
npm --prefix web run envio:up >".bootstrap.envio.log" 2>&1 &
ENVIO_PID=$!
echo "$ENVIO_PID" > ".bootstrap.envio.pid"
echo "      pid=$ENVIO_PID  log=.bootstrap.envio.log  graphql=http://localhost:8080/v1/graphql"

# ─── env.local ────────────────────────────────────────────────────────────────
echo "[4/5] writing web/.env.local"
tools/scripts/write-env.sh local

# ─── ui ───────────────────────────────────────────────────────────────────────
if [ "${BOOT_NO_UI:-0}" = "1" ]; then
  echo
  echo "=== bootstrap:local complete (BOOT_NO_UI=1) ==="
  echo "anvil pid : $ANVIL_PID"
  echo "envio pid : $ENVIO_PID"
  echo "rpc       : http://127.0.0.1:8545"
  echo "graphql   : http://localhost:8080/v1/graphql  (Hasura console :8080)"
  echo "env file  : web/.env.local"
  echo "teardown  : npm --prefix web run bootstrap:local:clean"
  exit 0
fi

echo "[5/5] launching next dev (Ctrl-C to stop; anvil + envio keep running)"
echo "      teardown: npm --prefix web run bootstrap:local:clean"
echo
exec npm --prefix web run dev
