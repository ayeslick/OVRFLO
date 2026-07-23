export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function normalizeAddress<T extends string>(address: T) {
  return address.toLowerCase() as Lowercase<T>;
}

export function shouldSkipMintTransfer(from: string) {
  return normalizeAddress(from) === ZERO_ADDRESS;
}

export function streamKey(chainId: number, contract: string, tokenId: bigint) {
  return `${normalizeAddress(contract)}-${chainId.toString()}-${tokenId.toString()}`;
}

export function assetKey(chainId: number, asset: string) {
  return `asset-${chainId.toString()}-${normalizeAddress(asset)}`;
}

export function applyWithdrawal({
  intactAmount,
  withdrawnAmount,
  amount,
}: {
  intactAmount: bigint;
  withdrawnAmount: bigint;
  amount: bigint;
}) {
  const nextIntactAmount = intactAmount > amount ? intactAmount - amount : 0n;
  return {
    withdrawnAmount: withdrawnAmount + amount,
    intactAmount: nextIntactAmount,
    depleted: nextIntactAmount === 0n,
  };
}
