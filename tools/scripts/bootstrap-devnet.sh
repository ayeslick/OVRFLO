#!/usr/bin/env bash
# bootstrap-devnet.sh — deploy + seed OVRFLO against a Tenderly Virtual Testnet
# and write web/.env.devnet pointing the UI at the VTN. Devnet stream discovery
# requires a Ponder instance indexing that same VTN RPC.
#
# Idempotency (R8): EXISTING_FACTORY=<0x...> reuses an already-deployed
# factory and only re-seeds the dev wallet. Otherwise a fresh deploy runs.
#
# Required env:
#   PRIVATE_KEY        hex deployer key, pre-funded on the VTN (~10 ETH)
#   DEV_WALLET         address receiving PT + stETH for UI testing
#   TENDERLY_RPC_URL   full Tenderly VTN JSON-RPC URL
#   PONDER_URL         SQL endpoint for a Ponder instance on that VTN
#
# Optional env:
#   REOWN_PROJECT_ID       baked into web/.env.devnet
#   EXISTING_FACTORY       reuse-mode (not yet wired — see TODO below)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail() { echo "bootstrap-devnet: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is not on PATH. ${2:-}"
}
require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is not set. ${2:-}"
}

require_cmd forge "Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
require_cmd cast  "Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
require_cmd jq    "brew install jq"
require_cmd npm   "Install Node 18+."
require_env PRIVATE_KEY
require_env DEV_WALLET
require_env TENDERLY_RPC_URL "Create a Tenderly Virtual Testnet and export its JSON-RPC URL."
require_env PONDER_URL "Run a Ponder instance against the same VTN and export its /sql URL."

# chain-id must be 1 — OVRFLO hardcodes mainnet protocol deps and the UI
# enforces the same check. Tenderly's VTNs are configured mainnet by default.
CHAIN_ID=$(cast chain-id --rpc-url "$TENDERLY_RPC_URL")
[ "$CHAIN_ID" = "1" ] || fail "Tenderly VTN chain id is $CHAIN_ID; must be 1 (mainnet alias)."

if [ -n "${EXISTING_FACTORY:-}" ]; then
  # TODO: wire reuse-mode through SeedDevnet.s.sol — today SeedDevnet always
  # deploys a fresh factory. When reuse lands, pass EXISTING_FACTORY to the
  # forge script via env and skip the deploy phase. R8 tracks this work.
  echo "bootstrap-devnet: EXISTING_FACTORY=$EXISTING_FACTORY — reuse mode requested."
  echo "                  SeedDevnet.s.sol does not yet honor this flag; running a fresh deploy."
fi

echo "[1/2] forge script SeedDevnet --broadcast"
forge script script/SeedDevnet.s.sol:SeedDevnet \
  --rpc-url "$TENDERLY_RPC_URL" \
  --broadcast \
  --slow

echo "[2/2] writing web/.env.devnet"
RPC_URL="$TENDERLY_RPC_URL" \
PONDER_URL="$PONDER_URL" \
  tools/scripts/write-env.sh devnet

echo
echo "=== bootstrap:devnet complete ==="
echo "deployment: deployments/devnet.json"
echo "env file  : web/.env.devnet"
echo "run the UI: cp web/.env.devnet web/.env.local && npm --prefix web run dev"
echo "teardown  : npm --prefix web run bootstrap:devnet:clean"
