export const SABLIER_LOCKUP = "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9" as const;

const _factory = process.env.NEXT_PUBLIC_OVRFLO_FACTORY;
if (!_factory) {
  throw new Error(
    "NEXT_PUBLIC_OVRFLO_FACTORY is not set. Add it to .env.local."
  );
}
export const OVRFLO_FACTORY = _factory;

const _chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "1");
if (!Number.isFinite(_chainId) || _chainId <= 0) {
  throw new Error(
    `NEXT_PUBLIC_CHAIN_ID is invalid ("${process.env.NEXT_PUBLIC_CHAIN_ID}"). Must be a positive integer.`
  );
}
export const CHAIN_ID = _chainId;

export const SABLIER_ENVIO_URL =
  "https://indexer.hyperindex.xyz/53b7e25/v1/graphql" as const;
