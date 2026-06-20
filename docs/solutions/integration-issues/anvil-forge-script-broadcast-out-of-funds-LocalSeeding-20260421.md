---
title: "forge script --broadcast reports 'lack of funds' on Anvil mainnet fork (foundry#11714)"
category: integration-issues
module: script/seed-local.sh
date: 2026-04-21
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "[OutOfFunds] EvmError: OutOfFunds when broadcaster calls payable functions (e.g. stETH.submit{value: 10 ether})"
  - "Error: Internal EVM error during simulation — transaction validation error: lack of funds (0) for max fee (10000000000000000000)"
  - "Broadcaster balance reads 0 at preflight despite vm.deal + anvil_setBalance setting 1000 ether"
  - "Failure only occurs against Anvil forked from mainnet, not on a clean in-memory EVM or Tenderly Virtual Testnet"
  - "Ancillary EIP-170 violation: 'Unknown0 is above the contract size limit (39277 > 24576)'"
root_cause: wrong_api
resolution_type: tooling_addition
tags:
  - foundry
  - forge-script
  - anvil-fork
  - broadcast
  - out-of-funds
  - eip-170
  - local-devnet
  - ovrflo
---

# forge script --broadcast reports 'lack of funds' on Anvil mainnet fork (foundry#11714)

## Problem

`forge script --broadcast` against a local Anvil mainnet fork refused to send
transactions from a freshly-derived broadcaster address because Foundry's
preflight balance check reads the broadcaster's *mainnet* state (balance `0`)
instead of the local Anvil state that `vm.deal` / `anvil_setBalance` actually
mutate. This blocked the entire `script/SeedLocal.s.sol` deployment and
seeding flow for OVRFLO fixtures — nothing could deploy locally without a
workaround.

## Symptoms

- `[OutOfFunds] EvmError: OutOfFunds` → `[Revert] OVRFLOSeedRunner: stETH submit failed`
  when the script called `stETH.submit{value: 10 ether}(...)` during broadcast.
- `Error: Internal EVM error during simulation` with
  `Context: - transaction validation error: lack of funds (0) for max fee (10000000000000000000)`
  after in-script balance workarounds.
- Broadcaster balance reported as `0` by Foundry's preflight even though
  `cast balance <addr> --rpc-url http://127.0.0.1:8545` returned `1000 ether`.
- Ancillary deploy error on the factory contract:
  `` Error: `Unknown0` is above the contract size limit (39277 > 24576) `` (EIP-170).

## What Didn't Work

- `vm.deal(broadcaster, 1000 ether)` inside the script — mutates local EVM
  state, but `forge script --broadcast` re-queries the fork RPC for the
  broadcaster's account info and ignores it.
- `vm.rpc("anvil_setBalance", [addr, "0x...e8d4a51000"])` before
  `vm.startBroadcast()` — Anvil's local balance is updated correctly, but
  Foundry's preflight still reads `{balance: 0, nonce: 0}` from the
  cheatcode-bypassing path.
- Extracting the funding dance into an `_ensureAnvilBroadcasterFunded`
  helper in `script/lib/OVRFLOSeedRunner.sol` — same bug, just relocated.
- Calling the payable `stETH.submit{value: 10 ether}` *after* stacking
  multiple balance-setting RPCs — inner call still reverted with
  `[OutOfFunds]` because the top-level tx never had funds attributed to it.
- `forge script --unlocked --sender <anvil-default>` — `--unlocked` governs
  impersonation of `--sender`, not the broadcaster's own preflight balance
  check, so the failure mode was unchanged.

Root cause: [foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714).
`forge script --broadcast` uses `eth_getAccountInfo` (non-standard,
fork-backed) for preflight, which on an Anvil mainnet fork returns the
broadcaster's real mainnet `{balance, nonce}` rather than Anvil's local
overrides.

## Solution

Abandoned `forge script --broadcast` for the local Anvil path and replaced
`script/SeedLocal.s.sol` with `script/seed-local.sh`, a bash driver built on
`forge create` + `cast send` + `cast rpc`. Those CLIs fetch balances via the
standard `eth_getBalance`, which Anvil answers correctly from local state.

```bash
set -euo pipefail
: "${MAINNET_RPC_URL:?}"
: "${DEV_WALLET:?}"
: "${PRIVATE_KEY:?}"
RPC="http://127.0.0.1:8545"

cast rpc anvil_setBalance "$DEV_WALLET" "0x3635c9adc5dea00000" \
  --rpc-url "$RPC" >/dev/null

FACTORY_ADDR=$(forge create \
  --rpc-url "$RPC" \
  --private-key "$PRIVATE_KEY" \
  --json \
  src/OVRFLOFactory.sol:OVRFLOFactory \
  --constructor-args "$SABLIER_LL" "$DEV_WALLET" \
  | jq -r .deployedTo)

cast send "$FACTORY_ADDR" 'approveMarket(address,uint256)' "$PT" 100 \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY"
```

Token seeding uses Anvil-native RPCs instead of on-chain `submit` calls so no
nested payable path can re-expose the preflight bug:

```bash
# stETH: write balance directly into the mapping slot
cast rpc anvil_setStorageAt "$STETH" "$BALANCE_SLOT" "$PACKED_AMOUNT" \
  --rpc-url "$RPC"

# USDC: impersonate a whale and transfer
cast rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$RPC"
cast send "$USDC" 'transfer(address,uint256)' "$DEV_WALLET" 1000000000000 \
  --rpc-url "$RPC" --unlocked --from "$USDC_WHALE"
```

The script finishes by writing `deployments/local.json` with addresses and
the fork block number for the web app and indexer to consume.

`script/SeedDevnet.s.sol` was deliberately left on `forge script` — it
targets a Tenderly Virtual Testnet, whose `eth_getAccountInfo` returns the
correct broadcaster state, so the bug doesn't trigger there.

The ancillary EIP-170 failure was fixed by turning the Solidity optimizer on
in `foundry.toml`:

```toml
[profile.default]
optimizer = true
optimizer_runs = 200
```

## Why This Works

`forge script --broadcast` performs a preflight "can this sender afford this
tx?" check by calling the non-standard `eth_getAccountInfo` RPC. On an Anvil
fork, that call is answered from the upstream fork's state (mainnet), not
from Anvil's locally-mutated state. Cheatcodes like `vm.deal` and even direct
`anvil_setBalance` calls modify Anvil's local state — the state every *real*
transaction sees — but they don't influence what `eth_getAccountInfo` returns
to Foundry's preflight, so a freshly-derived dev key shows up as
`{balance: 0, nonce: 0}` and the signer refuses to proceed.

`forge create` and `cast send` don't use that preflight path: they read
balances through plain `eth_getBalance`, which Anvil answers from its live
local state. Setting the dev wallet's balance via `anvil_setBalance` once at
the top of the bash script is therefore sufficient, and every subsequent
deploy / call sees funds. Using `anvil_setStorageAt` + whale
`anvil_impersonateAccount` for token balances avoids needing any payable
on-chain entrypoints (like `stETH.submit`) that would have re-exposed the
preflight bug via nested calls.

The optimizer fix is unrelated plumbing: unoptimized bytecode for
`OVRFLOFactory` exceeded EIP-170's 24,576-byte deployed-code limit; enabling
`optimizer = true`, `optimizer_runs = 200` brings it back under the cap with
negligible runtime cost.

## Prevention

- **Rule:** for any Anvil-targeted seed/deploy path, use `forge create` /
  `cast send` / `cast rpc` (or a viem/ethers equivalent). Do **not** use
  `forge script --broadcast` against Anvil until
  [foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714)
  ships. Tenderly-style fork networks are exempt because their RPCs return
  correct account state.
- **Canonical entrypoint:** `script/seed-local.sh` is the repo's local-devnet
  deploy + seed path. `script/SeedDevnet.s.sol` may keep using `forge script`
  because it targets Tenderly. Do not reintroduce a `script/SeedLocal.s.sol`.
- **CI smoke test:** spin up an ephemeral `anvil --fork-url $MAINNET_RPC_URL`
  in CI and run `bash script/seed-local.sh`, asserting `deployments/local.json`
  is produced and `cast balance $DEV_WALLET` is non-zero. Catches regressions
  if Foundry ships a fix and we choose to migrate back, or if Anvil changes
  `anvil_setStorageAt` behavior.
- **Env precheck:** `script/seed-local.sh` hard-fails (via `: "${VAR:?}"`) if
  `MAINNET_RPC_URL`, `DEV_WALLET`, or `PRIVATE_KEY` are missing. Prevents
  silent fallback to half-funded addresses.
- **`foundry.toml` guard:** keep `optimizer = true` / `optimizer_runs = 200`
  under `[profile.default]`; add a CI step (`forge build --sizes`) that fails
  if any deployed contract exceeds the 24,576-byte EIP-170 limit so
  size-regression lands early, before the contract becomes undeployable.
- **Docs:** link [foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714)
  from the repo README's local-dev section and from `script/seed-local.sh`'s
  header comment so future contributors understand why the bash script exists
  instead of a Forge script.

## Related Issues

- Upstream: [foundry-rs/foundry#11714 — forge script --broadcast uses eth_getAccountInfo against fork RPC](https://github.com/foundry-rs/foundry/issues/11714)
- [`script/seed-local.sh`](../../../script/seed-local.sh) — canonical local-devnet driver
- [`script/SeedDevnet.s.sol`](../../../script/SeedDevnet.s.sol) — Tenderly VTN path (`forge script` still works there)
- [`script/lib/OVRFLOSeedRunner.sol`](../../../script/lib/OVRFLOSeedRunner.sol) — shared helpers; NatSpec cross-references this bug
- [`foundry.toml`](../../../foundry.toml) — optimizer settings that resolved the ancillary EIP-170 error
- [`tools/scripts/bootstrap-local.sh`](../../../tools/scripts/bootstrap-local.sh) — orchestrator that calls `script/seed-local.sh`
- [`README.md`](../../../README.md) — Development → Local loop section documents the workflow end-to-end
