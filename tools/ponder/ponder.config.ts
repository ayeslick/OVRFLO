import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { SablierV2LockupLinearAbi } from "./abis/SablierV2LockupLinear";
import { OVRFLOFactoryAbi, OVRFLOLendingAbi } from "./abis/OVRFLO";

// Lending markets are deployed dynamically by the OVRFLO factory, so the
// borrow-demand source is a Ponder factory pattern over LendingDeployed.
// The zero-address default indexes nothing, keeping the indexer runnable
// before a factory is configured.
const OVRFLO_FACTORY = (process.env.PONDER_OVRFLO_FACTORY ??
  process.env.NEXT_PUBLIC_OVRFLO_FACTORY ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

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

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL ?? process.env.MAINNET_RPC_URL ?? "http://127.0.0.1:8545",
      pollingInterval: 2_000,
      disableCache: true,
    },
  },
  contracts: {
    SablierV2LockupLinear: {
      chain: "mainnet",
      abi: SablierV2LockupLinearAbi,
      address: "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9",
      startBlock: START_BLOCK,
    },
    OVRFLOLending: {
      chain: "mainnet",
      abi: OVRFLOLendingAbi,
      address: factory({
        address: OVRFLO_FACTORY,
        event: getAbiItem({ abi: OVRFLOFactoryAbi, name: "LendingDeployed" }),
        parameter: "lending",
      }),
      startBlock: START_BLOCK,
    },
  },
});
