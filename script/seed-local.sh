#!/usr/bin/env bash
# seed-local.sh — deploy + approve + seed OVRFLO on a local anvil fork.
#
# Why not a `forge script --broadcast`? The broadcast validator queries
# account state via `eth_getAccountInfo`, which anvil in fork mode
# currently returns `{balance:0, nonce:0}` for (foundry#11714). Every
# tx then gets rejected as `lack of funds (0) for max fee (...)`. This
# driver sidesteps the validator entirely by going through
# `forge create` / `cast send` / `anvil_setStorageAt`, whose code
# paths are not regressed.
#
# Usage (from repo root):
#   anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1 --fork-block-number 24609670
#   ./script/seed-local.sh
#
# Overrides: PRIVATE_KEY, DEV_WALLET, RPC.

set -euo pipefail

RPC=${RPC:-http://127.0.0.1:8545}
OWNER_PK=${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
DEV_WALLET=${DEV_WALLET:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}
OWNER=$(cast wallet address "$OWNER_PK")

# Fixture constants — must stay in lockstep with script/lib/OVRFLOTestFixtures.sol.
TREASURY=0x0000000000000000000000000000000000000456
STETH=0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
ORACLE=0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
PRIMARY_MARKET=0xcFD848b9f6fEf552204014ac67901223AD6bf679
PRIMARY_PT=0x9cE6478EF45bB1BAAC69EFd8A3eA0ed110a43042
SECONDARY_MARKET=0x34280882267ffa6383B363E278B027Be083bBe3b
SECONDARY_PT=0xb253Eff1104802b97aC7E3aC9FdD73AecE295a2c
TWAP=900
NAME_SUFFIX="Lido Staked Ether"
SYMBOL_SUFFIX="STETH"
PT_SEED_AMOUNT=1000000000000000000000   # 1000 * 1e18
STETH_SEED_ETH=10ether

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN_ID" != "1" ]; then
  echo "seed-local: expected chain id 1 (frontend enforces mainnet), got $CHAIN_ID" >&2
  echo "seed-local: start anvil with --chain-id 1" >&2
  exit 1
fi

mkdir -p deployments

send() {
  cast send --rpc-url "$RPC" --private-key "$OWNER_PK" "$@" >/dev/null
}

echo "seed-local: owner      = $OWNER"
echo "seed-local: dev wallet = $DEV_WALLET"
echo

echo "[1/6] deploy OVRFLOFactory"
FACTORY_JSON=$(
  forge create \
    --rpc-url "$RPC" --private-key "$OWNER_PK" --broadcast --json \
    src/OVRFLOFactory.sol:OVRFLOFactory \
    --constructor-args "$OWNER"
)
FACTORY=$(echo "$FACTORY_JSON" | jq -r '.deployedTo')
echo "      factory = $FACTORY"

echo "[2/6] configure + deploy OVRFLO + OVRFLOToken"
send "$FACTORY" \
  'configureDeployment(address,address,string,string)' \
  "$TREASURY" "$STETH" "$NAME_SUFFIX" "$SYMBOL_SUFFIX"
send "$FACTORY" 'deploy()'
OVRFLO=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrflos(uint256)(address)' 0)
TOKEN=$(cast call --rpc-url "$RPC" "$FACTORY" \
  'ovrfloInfo(address)(address,address,address)' "$OVRFLO" \
  | sed -n '3p')
echo "      ovrflo  = $OVRFLO"
echo "      token   = $TOKEN"

echo "[3/6] prepare oracles for both markets"
send "$FACTORY" 'prepareOracle(address,address,uint32)' \
  "$PRIMARY_MARKET" "$ORACLE" "$TWAP"
send "$FACTORY" 'prepareOracle(address,address,uint32)' \
  "$SECONDARY_MARKET" "$ORACLE" "$TWAP"

echo "[4/6] approve markets (primary fee=25bps, secondary fee=10bps)"
send "$FACTORY" 'addMarket(address,address,address,uint32,uint16)' \
  "$OVRFLO" "$PRIMARY_MARKET"   "$ORACLE" "$TWAP" 25
send "$FACTORY" 'addMarket(address,address,address,uint32,uint16)' \
  "$OVRFLO" "$SECONDARY_MARKET" "$ORACLE" "$TWAP" 10

echo "[5/6] seed dev wallet with PT + stETH"
# Pendle PT inherits OZ ERC20, so balances live in mapping at slot 0.
# Slot for balanceOf[DEV_WALLET] is keccak256(abi.encode(DEV_WALLET, uint256(0))).
PT_SLOT=$(cast index address "$DEV_WALLET" 0)
AMOUNT_HEX=$(cast to-uint256 "$PT_SEED_AMOUNT")
cast rpc --rpc-url "$RPC" anvil_setStorageAt \
  "$PRIMARY_PT"   "$PT_SLOT" "$AMOUNT_HEX" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setStorageAt \
  "$SECONDARY_PT" "$PT_SLOT" "$AMOUNT_HEX" >/dev/null
for PT in "$PRIMARY_PT" "$SECONDARY_PT"; do
  BAL=$(cast call --rpc-url "$RPC" "$PT" 'balanceOf(address)(uint256)' "$DEV_WALLET" \
    | awk '{print $1}')
  if [ "$BAL" != "$PT_SEED_AMOUNT" ]; then
    echo "      PT $PT: balance slot is NOT 0 (got $BAL, expected $PT_SEED_AMOUNT)" >&2
    echo "      probe the correct slot with cast storage and update PT_SLOT" >&2
    exit 1
  fi
done
echo "      PT balances planted (slot 0)"

send --value "$STETH_SEED_ETH" "$STETH" \
  'submit(address)' 0x0000000000000000000000000000000000000000
STETH_BAL=$(cast call --rpc-url "$RPC" "$STETH" \
  'balanceOf(address)(uint256)' "$OWNER" | awk '{print $1}')
send "$STETH" 'transfer(address,uint256)' "$DEV_WALLET" "$STETH_BAL"
echo "      stETH seeded ($STETH_BAL wei)"

echo "[6/6] write deployments/local.json"
jq -n \
  --arg factory   "$FACTORY" \
  --arg ovrflo    "$OVRFLO" \
  --arg token     "$TOKEN" \
  --arg devWallet "$DEV_WALLET" \
  '{chainId: 1, factory: $factory, ovrflo: $ovrflo, token: $token, devWallet: $devWallet}' \
  > deployments/local.json

echo
echo "=== OVRFLO seed complete ==="
echo "factory:   $FACTORY"
echo "ovrflo:    $OVRFLO"
echo "token:     $TOKEN"
echo "devWallet: $DEV_WALLET"
echo "artifact:  deployments/local.json"
