# Attribution — `tools/envio/`

This directory contains a minimal Sablier LockupLinear v1.1 indexer used
only by the OVRFLO local bootstrap loop (`bootstrap:local`). It is
**derivative of** — though not a verbatim vendoring of —
[`sablier-labs/indexers`](https://github.com/sablier-labs/indexers).

## Upstream pin

| Source | Version | SHA |
| --- | --- | --- |
| [sablier-labs/indexers](https://github.com/sablier-labs/indexers) | `v5.0.0` | `ff4bede6dc6ca226b795ce7e11065314f32dd4f4` |
| [sablier (npm)](https://www.npmjs.com/package/sablier) | `3.11.1` | — |

`abi/SablierV2LockupLinear.json` is copied verbatim from the `sablier@3.11.1`
npm package (`package/abi/lockup/v1.1/SablierV2LockupLinear.json`). Upstream
is published under GPL-3.0-or-later and MIT for the ABI artifacts.

`schema.graphql` field names and types are a strict subset of upstream's
`envio/streams/streams.graphql`. Handler logic is OVRFLO-specific but
models event semantics after upstream's `envio/streams/mappings/lockup/*`.

## License

`sablier-labs/indexers` is licensed under **GPL-3.0-or-later**. This
directory (`tools/envio/`) inherits that license as the derivative work.

The rest of the OVRFLO repository is licensed per each file's SPDX header
and **is not** covered by GPL-3.0 — the derivative relationship is
isolated to `tools/envio/` by directory scope. Removing or replacing the
contents of `tools/envio/` removes any GPL-3.0 exposure from the repo.

Full GPL-3.0 text: <https://www.gnu.org/licenses/gpl-3.0.en.html>.

## Bump workflow

See `tools/envio/README.md`.
