#!/usr/bin/env bash
# bootstrap-e2e.sh — tear down any existing local E2E environment and bring
# up a fresh one (anvil fork + seed + Ponder + dev server + generated
# Playwright specs), ready for `npx playwright test` with no manual steps in
# between. Composes the existing bootstrap-clean.sh / bootstrap-local.sh
# rather than duplicating them; the only genuinely new pieces here are (a)
# always tearing down first instead of refusing a second "up", (b) starting
# the dev server backgrounded instead of bootstrap-local.sh's default
# foreground `exec`, and (c) running bddgen so `.features-gen/` is current.
#
# Usage:
#   tools/scripts/bootstrap-e2e.sh
#
# Env:
#   MAINNET_RPC_URL — required, forwarded to bootstrap-local.sh (see its own
#                     header for details).
#
# Teardown: tools/scripts/bootstrap-clean.sh local also stops the dev server
# started here (tracked via .bootstrap.web.pid, the same convention as
# anvil/ponder's own pid files).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail() { echo "bootstrap-e2e: $*" >&2; exit 1; }

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "$name is not set. Export your mainnet archive RPC (Alchemy, QuickNode, paid Infura)."
  fi
}
require_env MAINNET_RPC_URL

WEB_PID_FILE=".bootstrap.web.pid"
WEB_LOG=".bootstrap.web.log"

# ─── teardown ────────────────────────────────────────────────────────────────
# bootstrap-clean.sh handles anvil, ponder (incl. its orphaned-grandchild
# case), and — now — this script's own dev server pid file the same way.
echo "[1/4] tearing down any existing local environment"
tools/scripts/bootstrap-clean.sh local

# ─── bring up anvil + seed + ponder ──────────────────────────────────────────
echo "[2/4] bootstrapping anvil + seed + ponder (bootstrap-local.sh)"
BOOT_NO_UI=1 tools/scripts/bootstrap-local.sh

# ─── dev server ───────────────────────────────────────────────────────────────
echo "[3/4] starting the E2E dev server in the background"
(
  cd web
  NEXT_PUBLIC_E2E=1 nohup npm run dev >"../$WEB_LOG" 2>&1 &
  echo $! > "../$WEB_PID_FILE"
)
READY=0
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3000 >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "--- dev server log (last 40 lines) ---" >&2
  tail -n 40 "$WEB_LOG" >&2 || true
  fail "dev server did not become ready — check $WEB_LOG"
fi
echo "      pid=$(cat "$WEB_PID_FILE")  url=http://localhost:3000  log=$WEB_LOG"

# ─── bddgen ───────────────────────────────────────────────────────────────────
echo "[4/4] generating Playwright BDD specs"
(cd web && npx bddgen)

echo
echo "=== e2e testbed ready ==="
echo "app        : http://localhost:3000  (log: $WEB_LOG)"
echo "rpc        : http://127.0.0.1:8545  (log: .bootstrap.anvil.log)"
echo "ponder sql : http://localhost:42069/sql  (log: .bootstrap.ponder.log)"
echo "run tests  : cd web && NEXT_PUBLIC_E2E=1 npx playwright test [path] [-g \"<pattern>\"]"
echo "teardown   : tools/scripts/bootstrap-clean.sh local"
