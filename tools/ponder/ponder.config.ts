import { createConfig } from "ponder";
import { SablierV2LockupLinearAbi } from "./abis/SablierV2LockupLinear";

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
      startBlock: 24609500,
    },
  },
});
