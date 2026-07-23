import { parseAbi } from "viem";

export const SablierV2LockupLinearAbi = parseAbi([
  "event CreateLockupLinearStream(uint256 streamId, address funder, address indexed sender, address indexed recipient, (uint128 deposit, uint128 protocolFee, uint128 brokerFee) amounts, address indexed asset, bool cancelable, bool transferable, (uint40 start, uint40 cliff, uint40 end) range, address broker)",
  "event CancelLockupStream(uint256 streamId, address indexed sender, address indexed recipient, address indexed asset, uint128 senderAmount, uint128 recipientAmount)",
  "event WithdrawFromLockupStream(uint256 indexed streamId, address indexed to, address indexed asset, uint128 amount)",
  "event RenounceLockupStream(uint256 indexed streamId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
