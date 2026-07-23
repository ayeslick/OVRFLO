export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function shouldSkipMintTransfer(from: string) {
  return from.toLowerCase() === ZERO_ADDRESS;
}
