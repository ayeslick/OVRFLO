# `tools/envio/` — Local Sablier indexer

A minimal Envio HyperIndex project that indexes `SablierV2LockupLinear v1.1`
(`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`) against the local anvil fork
so the OVRFLO web UI's `GetUserStreams` query can run offline.

The hosted Sablier Envio endpoint continues to back devnet + mainnet. This
project only runs during `bootstrap:local`.

## Why not vendor the full upstream indexer?

`sablier-labs/indexers` ships handlers for every Sablier version (Flow
v1–v3, Lockup v1.0 through v4.0) across ~15 chains. OVRFLO only integrates
with **one** contract on **one** chain, so the vendoring surface is tiny.
See `NOTICE.md` for the pin, attribution, and GPL-3.0 posture.

## Prerequisites

- Docker (Envio brings up Postgres + Hasura via its internal
  docker-compose).
- pnpm — Envio's preferred package manager.
- A local anvil fork on `http://localhost:8545` with `--chain-id 1`.

## One-time install

```bash
cd tools/envio
pnpm install
pnpm run codegen
```

`codegen` regenerates the `generated/` directory (ABI type bindings,
event handler types) from `config.yaml` + `schema.graphql`. Rerun after
editing either file.

## Run locally

The top-level OVRFLO package surfaces thin wrappers:

```bash
# From repo root:
npm run envio:dev    # equivalent to (cd tools/envio && pnpm envio dev)
npm run envio:start  # production-style; requires prior codegen
npm run envio:stop
npm run envio:reset  # stops + wipes Postgres volume + restarts
npm run envio:logs
```

Under the hood:

- `envio dev` — hot-reloads handler code, runs from block 0 if DB is empty.
- `envio start` — no hot reload; expects `generated/` to exist.
- `envio local stop --reset` — wipes the Postgres volume. **Always run
  this after restarting anvil** — a new fork gets a new chain state and
  the old indexed blocks become phantom.

Hasura console once running: <http://localhost:8080/console>
(admin secret `testing`).

Sample query:

```graphql
{
  LockupStream(
    where: {
      contract: { _eq: "0xafb979d9afad1ad27c5eff4e27226e3ab9e5dcc9" }
      chainId: { _eq: "1" }
    }
    order_by: { tokenId: desc }
  ) {
    id
    tokenId
    recipient
    sender
    depositAmount
    withdrawnAmount
    intactAmount
    canceled
    depleted
  }
}
```

## Bump workflow

Upstream rarely changes the LockupLinear v1.1 ABI (it's a deployed
mainnet contract), but the schema shape and event handler conventions
evolve. When bumping:

1. Update the SHA pin in `NOTICE.md` to the new `sablier-labs/indexers`
   commit.
2. Diff upstream `envio/streams/streams.graphql` against our
   `schema.graphql` — our file is a strict subset; add fields only if
   `web/lib/sablier.ts` starts selecting them.
3. Diff upstream `envio/streams/mappings/lockup/v1.1/SablierV2LockupLinear.ts`
   + its common helpers against our `src/EventHandlers.ts`. Apply any
   semantic fixes (e.g., Sablier's indexer recently skips mint Transfers,
   which is already handled here).
4. If the `sablier` npm package emits a new ABI for v1.1 (rare),
   re-copy `abi/SablierV2LockupLinear.json` from the latest
   `sablier@x.y.z` package.
5. Rerun `pnpm run codegen` in `tools/envio/`.
6. `npm run envio:reset` to wipe + re-index.

## Divergences from upstream, by design

- Single contract, single chain (`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` on chain 1).
- No Flow, Tranched, or Dynamic stream support.
- No batch/batcher/sponsor entities.
- No shape inference (`shape` and `shapeSource` fields omitted — only
  available in Lockup v2.0+).
- `Asset` is minimally populated — the UI resolves symbol/decimals via
  viem `readContracts` rather than indexer data for most surfaces.
