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

const START_BLOCK = 24609500;

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
