export const ovrfloFactoryAbi = [
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "ovrflos",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "ovrfloCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "ovrflo", type: "address" }],
    name: "ovrfloInfo",
    outputs: [
      { name: "treasury", type: "address" },
      { name: "underlying", type: "address" },
      { name: "ovrfloToken", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "ovrflo", type: "address" }],
    name: "approvedMarketCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "ovrflo", type: "address" },
      { name: "index", type: "uint256" },
    ],
    name: "getApprovedMarket",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const ovrfloAbi = [
  {
    inputs: [{ name: "", type: "address" }],
    name: "series",
    outputs: [
      { name: "approved", type: "bool" },
      { name: "twapDurationFixed", type: "uint32" },
      { name: "feeBps", type: "uint16" },
      { name: "expiryCached", type: "uint256" },
      { name: "ptToken", type: "address" },
      { name: "ovrfloToken", type: "address" },
      { name: "underlying", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "market", type: "address" },
      { name: "ptAmount", type: "uint256" },
    ],
    name: "previewDeposit",
    outputs: [
      { name: "toUser", type: "uint256" },
      { name: "toStream", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "rateE18", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "market", type: "address" },
      { name: "ptAmount", type: "uint256" },
      { name: "minToUser", type: "uint256" },
    ],
    name: "deposit",
    outputs: [
      { name: "toUser", type: "uint256" },
      { name: "toStream", type: "uint256" },
      { name: "streamId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "ptToken", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "ptToken", type: "address" }],
    name: "claimablePt",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const sablierLockupAbi = [
  {
    inputs: [
      { name: "streamId", type: "uint256" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint128" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "streamId", type: "uint256" },
      { name: "to", type: "address" },
    ],
    name: "withdrawMax",
    outputs: [{ name: "withdrawnAmount", type: "uint128" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "withdrawableAmountOf",
    outputs: [{ name: "withdrawableAmount", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "calculateMinFeeWei",
    outputs: [{ name: "minFeeWei", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "getRecipient",
    outputs: [{ name: "recipient", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "statusOf",
    outputs: [{ name: "status", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const erc20Abi = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
